// Run any Versline tool from a searchable list, with a form generated from its schema.
// New Versline tools appear here automatically; this module also exposes the Obsidian CLI handlers.
import { FuzzySuggestModal, type FuzzyMatch, type TAbstractFile, TFile } from "obsidian";
import type { ToolSpec } from "../bridge/protocol";
import { acceptsExtension, primaryInput } from "../bridge/schema";
import type { ModuleContext, VersobsModule } from "../core/module";
import { applyDirection, pick, t } from "../i18n";
import { notifyOutputs } from "./_shared";

class ToolPicker extends FuzzySuggestModal<ToolSpec> {
	constructor(
		private ctx: ModuleContext,
		private tools: ToolSpec[],
		private source: TAbstractFile | null,
	) {
		super(ctx.app);
		applyDirection(this.modalEl);
		this.setPlaceholder(t("runner.placeholder"));
	}

	getItems(): ToolSpec[] {
		return this.tools;
	}

	getItemText(tool: ToolSpec): string {
		return `${pick(tool.title)} ${tool.title.en} ${tool.name} ${tool.tags.join(" ")}`;
	}

	override renderSuggestion(match: FuzzyMatch<ToolSpec>, el: HTMLElement): void {
		el.createDiv({ text: pick(match.item.title, match.item.name) });
		el.createDiv({ text: pick(match.item.description), cls: "versobs-muted versobs-small" });
	}

	onChooseItem(tool: ToolSpec): void {
		void runGeneric(this.ctx, tool, this.source);
	}
}

/** Prefill the tool's main input from the active file when it accepts that kind of file. */
function prefill(tool: ToolSpec, source: TAbstractFile | null): Record<string, unknown> {
	const input = primaryInput(tool);
	if (!input || !(source instanceof TFile) || !acceptsExtension(input.schema, source.extension)) return {};
	return { [input.key]: input.schema["x-widget"] === "files" ? [source.path] : source.path };
}

async function runGeneric(ctx: ModuleContext, tool: ToolSpec, source: TAbstractFile | null): Promise<void> {
	const result = await ctx.core.runTool({ tool: tool.name, values: prefill(tool, source) });
	notifyOutputs(ctx.core, result);
	await ctx.core.finish(result, { source });
}

async function openPicker(ctx: ModuleContext): Promise<void> {
	if (!(await ctx.core.bridge.ready())) {
		ctx.core.openSetup();
		return;
	}
	const tools = (ctx.core.bridge.manifest?.tools ?? []).filter((tool) => !tool.hidden);
	new ToolPicker(ctx, tools, ctx.app.workspace.getActiveFile()).open();
}

function registerCli(ctx: ModuleContext): void {
	const plugin = ctx.core.plugin;
	try {
		plugin.registerCliHandler("versobs", t("cli.status"), null, async () => {
			await ctx.core.bridge.refresh();
			const bridge = ctx.core.bridge;
			return bridge.state === "ready"
				? `Versline ${bridge.manifest?.versline} (${bridge.executable}); ${bridge.manifest?.tools.length} tools`
				: `Versline: ${bridge.state}${bridge.error ? ` (${bridge.error})` : ""}`;
		});
		plugin.registerCliHandler(
			"versobs:run",
			t("cli.run"),
			{
				tool: { value: "<name>", description: t("cli.flagTool"), required: true },
				file: { value: "<path>", description: t("cli.flagFile") },
				params: { value: "<json>", description: t("cli.flagParams") },
			},
			async (data) => {
				const spec = await ctx.core.requireTool(data.tool ?? "");
				if (!spec) return `Unknown or unavailable tool: ${data.tool}`;
				const source = data.file ? ctx.app.vault.getFileByPath(data.file) : null;
				const values = { ...prefill(spec, source), ...(data.params ? (JSON.parse(data.params) as Record<string, unknown>) : {}) };
				const result = await ctx.core.runTool({ tool: spec.name, values, skipForm: true, remember: false, retryable: false });
				if (!result) return "Not started";
				if (result.outcome.status !== "success") return `${result.outcome.status}: ${result.outcome.error?.message ?? ""}`;
				return result.outcome.artifacts.map((a) => ctx.core.paths.toVault(a.path) ?? a.path).join("\n") || "Done";
			},
		);
	} catch (err) {
		console.warn("[versobs] CLI handlers not registered", err);
	}
}

export const toolRunnerModule: VersobsModule = {
	id: "tool-runner",
	name: "module.runner",
	description: "module.runner.desc",
	load(ctx) {
		ctx.addCommand({ id: "pick", name: t("runner.cmd"), icon: "wand-2", callback: () => void openPicker(ctx) });
		registerCli(ctx);
	},
};
