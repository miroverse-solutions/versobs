// The hub modules talk to: settings, bridge, jobs, paths, and the "ask options → run job → handle outputs" flow.
import { type App, Notice, type TAbstractFile, TFile } from "obsidian";
import type { RunOutcome } from "../bridge/client";
import type { ToolSpec } from "../bridge/protocol";
import { defaultsOf, expandPattern, fieldsOf, isPathWidget, primaryInput, primaryOutput } from "../bridge/schema";
import { pick, t } from "../i18n";
import type { Job, JobManager } from "../jobs/job-manager";
import type VersobsPlugin from "../main";
import { notifyOutputs } from "../modules/_shared";
import { openForm } from "../ui/schema-form-modal";
import { SetupModal } from "../ui/setup-modal";
import type { BridgeService } from "./bridge-service";
import { safeFileName, timestamp, VaultPaths } from "./paths";
import type { VersobsSettings } from "./settings";

export interface RunOptions {
	tool: string;
	title?: string;
	/** Initial form values; path fields hold vault paths (or absolute paths / links). */
	values?: Record<string, unknown>;
	/** Fields the caller fills and the form does not show. */
	hidden?: string[];
	/** Run immediately with the given values (no form). */
	skipForm?: boolean;
	intro?: string;
	submitText?: string;
	/** Remember the chosen options for next time (default true). */
	remember?: boolean;
	/** Adjust the values after the form (e.g. derive an output folder from another field). */
	transform?: (values: Record<string, unknown>) => Record<string, unknown>;
	/** On failure, keep waiting so a retry from the jobs panel continues this flow (default true; the CLI passes false). */
	retryable?: boolean;
}

export interface RunResult {
	job: Job;
	outcome: RunOutcome;
	/** The form values as submitted (vault paths). */
	values: Record<string, unknown>;
	spec: ToolSpec;
}

export interface FinishOptions {
	source?: TAbstractFile | null;
	/** Open the first produced note (default: the "open results" setting). */
	open?: boolean;
	/** Add versline_* properties to produced notes (default: the setting; bulk tools pass false). */
	stamp?: boolean;
}

const NOT_REMEMBERED_WIDGETS = new Set(["file", "files", "folder", "output-file", "output-folder", "textarea", "secret"]);

export class Versobs {
	readonly paths: VaultPaths;

	constructor(
		readonly app: App,
		readonly plugin: VersobsPlugin,
		readonly bridge: BridgeService,
		readonly jobs: JobManager,
	) {
		this.paths = new VaultPaths(app);
	}

	get settings(): VersobsSettings {
		return this.plugin.settings;
	}

	save(): Promise<void> {
		return this.plugin.saveSettings();
	}

	openSetup(): void {
		new SetupModal(this.app, this.bridge, () => this.plugin.openSettings()).open();
	}

	/** The tool's spec once Versline is usable; otherwise explain what is missing and return null. */
	async requireTool(name: string): Promise<ToolSpec | null> {
		if (!(await this.bridge.ready())) {
			this.openSetup();
			return null;
		}
		const spec = this.bridge.tool(name);
		if (!spec) {
			new Notice(t("notice.toolMissing", { tool: name }), 8000);
			return null;
		}
		return spec;
	}

	/** Ask for options (unless skipForm), run the tool as a job, and wait for it. */
	async runTool(options: RunOptions): Promise<RunResult | null> {
		const spec = await this.requireTool(options.tool);
		if (!spec) return null;
		const remembered = options.remember === false ? {} : (this.settings.lastParams[spec.name] ?? {});
		let values: Record<string, unknown> = { ...defaultsOf(spec), ...remembered, ...(options.values ?? {}) };
		this.fillOutputDefault(spec, values, options.values ?? {});

		if (!options.skipForm) {
			const submitted = await openForm(this.app, {
				spec,
				values,
				hidden: options.hidden,
				title: options.title,
				intro: options.intro,
				submitText: options.submitText,
			});
			if (!submitted) return null;
			values = { ...pickHidden(values, options.hidden), ...submitted };
			if (options.remember !== false) await this.remember(spec, values);
		}

		if (options.transform) values = options.transform(values);
		const params = this.toBridgeParams(spec, values);
		await this.ensureOutputFolders(spec, values);
		const title = options.title ?? pick(spec.title, spec.name);
		const { job, done } = this.jobs.submit({
			tool: spec.name,
			title,
			params,
			sourcePath: this.sourceOf(spec, values),
			retryable: options.retryable,
		});
		new Notice(t("notice.started", { title }), 2500);
		const outcome = await done;
		return { job, outcome, values, spec };
	}

	/** Run a failed or interrupted job again (Versline resumes from its cached progress). */
	async retryJob(job: Job): Promise<void> {
		if (!(await this.requireTool(job.tool))) return;
		if (this.jobs.retry(job)) new Notice(t("notice.started", { title: job.title }), 2500);
	}

	/** Outputs of a job nobody is waiting for (retried after a restart or after its caller gave up). */
	async finishDetached(job: Job): Promise<void> {
		const spec = this.bridge.tool(job.tool);
		if (!spec || !job.outcome) return;
		const source = job.sourcePath ? this.app.vault.getAbstractFileByPath(job.sourcePath) : null;
		const result: RunResult = { job, outcome: job.outcome, values: {}, spec };
		notifyOutputs(this, result);
		await this.finish(result, { source });
	}

	/** Vault path of the tool's first input, when it is a file in this vault. */
	private sourceOf(spec: ToolSpec, values: Record<string, unknown>): string | null {
		const input = primaryInput(spec);
		if (!input) return null;
		const value = values[input.key];
		const first: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
		if (typeof first !== "string" || !first || /^https?:/i.test(first) || VaultPaths.isAbsolute(first)) return null;
		return this.app.vault.getAbstractFileByPath(first) ? first : null;
	}

	/** Default output path from the tool's x-output pattern and the first input, if the caller gave none. */
	private fillOutputDefault(spec: ToolSpec, values: Record<string, unknown>, given: Record<string, unknown>): void {
		const output = primaryOutput(spec);
		const input = primaryInput(spec);
		if (!output || !input || given[output.key] !== undefined) return;
		const pattern = output.schema["x-output"];
		const first = Array.isArray(values[input.key]) ? (values[input.key] as string[])[0] : values[input.key];
		if (pattern && typeof first === "string" && first && !/^https?:/i.test(first)) {
			values[output.key] = expandPattern(pattern, first, values);
		}
	}

	/** Vault paths in path fields become absolute paths; links and absolute paths pass through. */
	toBridgeParams(spec: ToolSpec, values: Record<string, unknown>): Record<string, unknown> {
		const params: Record<string, unknown> = {};
		const convert = (v: unknown) =>
			typeof v === "string" && !/^https?:\/\//i.test(v) ? this.paths.abs(v) : v;
		for (const field of fieldsOf(spec)) {
			const value = values[field.key];
			if (value === undefined) continue;
			if (isPathWidget(field.schema)) params[field.key] = Array.isArray(value) ? value.map(convert) : convert(value);
			else params[field.key] = value;
		}
		return params;
	}

	private async ensureOutputFolders(spec: ToolSpec, values: Record<string, unknown>): Promise<void> {
		for (const field of fieldsOf(spec)) {
			const widget = field.schema["x-widget"];
			const value = values[field.key];
			if (typeof value !== "string" || !value || VaultPaths.isAbsolute(value)) continue;
			if (widget === "output-folder") await this.paths.ensureFolder(value);
			if (widget === "output-file") await this.paths.ensureFolder(value.split("/").slice(0, -1).join("/"));
		}
	}

	private async remember(spec: ToolSpec, values: Record<string, unknown>): Promise<void> {
		const keep: Record<string, unknown> = {};
		for (const field of fieldsOf(spec)) {
			if (NOT_REMEMBERED_WIDGETS.has(field.schema["x-widget"] ?? "")) continue;
			if (field.key === "force" || field.key === "dry_run") continue;
			if (values[field.key] !== undefined) keep[field.key] = values[field.key];
		}
		this.settings.lastParams[spec.name] = keep;
		await this.save();
	}

	/** Vault path for a new note/folder named `name`, next to `source` or in the output folder. */
	outputPath(source: TAbstractFile | null, name: string): string {
		const folder =
			this.settings.outputPlacement === "folder" || !source
				? this.settings.outputFolder.trim()
				: this.paths.folderOf(source);
		return VaultPaths.join(folder, safeFileName(name));
	}

	/** Notes produced by a job: wait for them in the vault, add properties, open the first. */
	async finish(result: RunResult | null, options: FinishOptions = {}): Promise<TFile[]> {
		if (!result || result.outcome.status !== "success") return [];
		const notes: TFile[] = [];
		const paths = result.outcome.artifacts
			.filter((a) => a.exists && (a.kind === "note" || /\.md$/i.test(a.path)))
			.map((a) => this.paths.toVault(a.path))
			.filter((p): p is string => p !== null);
		for (const path of paths.slice(0, 200)) {
			const file = await this.paths.waitForFile(path, notes.length ? 1500 : 5000);
			if (file) notes.push(file);
		}
		if ((options.stamp ?? true) && this.settings.stampProperties) {
			for (const note of notes.slice(0, 20)) await this.stamp(note, result, options.source ?? null);
		}
		if ((options.open ?? this.settings.openResults) && notes[0]) {
			await this.app.workspace.getLeaf("tab").openFile(notes[0]);
		}
		return notes;
	}

	private async stamp(note: TFile, result: RunResult, source: TAbstractFile | null): Promise<void> {
		const model = this.bridge.currentModel();
		const cost = result.outcome.cost;
		try {
			await this.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
				fm.versline_tool ??= result.spec.name;
				if (source instanceof TFile && source.path !== note.path) {
					fm.versline_source ??= `[[${this.app.metadataCache.fileToLinktext(source, note.path, false)}]]`;
				}
				if (model) fm.versline_model ??= model;
				if (cost?.usd) fm.versline_cost_usd = Number(cost.usd.toFixed(6));
				if (cost?.irt) fm.versline_cost_irt = Math.round(cost.irt);
				fm.created ??= timestamp(new Date(), true, "T");
			});
		} catch (err) {
			console.warn("[versobs] could not add properties to", note.path, err);
		}
	}

	/** Open a file outside Obsidian's editors (HTML deck, Word file, folder) with the system default app. */
	async openExternal(absPath: string): Promise<void> {
		const error = await electronShell()?.openPath(absPath);
		if (error) new Notice(error);
	}

	showInFolder(absPath: string): void {
		electronShell()?.showItemInFolder(absPath);
	}
}

function pickHidden(values: Record<string, unknown>, hidden: string[] | undefined): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of hidden ?? []) if (values[key] !== undefined) out[key] = values[key];
	return out;
}

interface ElectronShell {
	openPath(path: string): Promise<string>;
	showItemInFolder(path: string): void;
}

function electronShell(): ElectronShell | undefined {
	const req = (window as unknown as { require?: (id: string) => unknown }).require;
	return (req?.("electron") as { shell?: ElectronShell } | undefined)?.shell;
}
