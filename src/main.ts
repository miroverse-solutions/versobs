import { ConfirmationModal, getLanguage, Notice, Plugin } from "obsidian";
import { BridgeService } from "./core/bridge-service";
import { ModuleHost } from "./core/module-host";
import { migrateSettings, type VersobsSettings } from "./core/settings";
import { VersobsSettingTab } from "./core/settings-tab";
import { Versobs } from "./core/versobs";
import { resolveLanguage, setLanguage, t } from "./i18n";
import { type Job, JobManager } from "./jobs/job-manager";
import { JobStore } from "./jobs/job-store";
import { JOBS_VIEW, JobsView } from "./jobs/jobs-view";
import { StatusBar } from "./jobs/status-bar";
import { MODULES } from "./modules";
import { askUser } from "./ui/prompt-modal";

interface PluginStatus {
	installed: string | null;
	latest: string | null;
	update_available: boolean;
	error: string | null;
}

interface InstallResult {
	status: string;
	version: string;
}

interface VerslineUpdate {
	current: string;
	latest: string;
	update_available: boolean;
}

export default class VersobsPlugin extends Plugin {
	declare settings: VersobsSettings;
	core!: Versobs;
	host!: ModuleHost;
	private statusBar!: StatusBar;
	private jobStore: JobStore | null = null;

	override async onload(): Promise<void> {
		this.settings = migrateSettings(await this.loadData());
		setLanguage(resolveLanguage(this.settings.language, getLanguage()));

		const bridge = new BridgeService(this.app, () => this.settings);
		const jobs = new JobManager(
			bridge,
			() => this.settings.concurrency,
			(request) =>
				askUser(this.app, {
					jobTitle: request.job.title,
					message: request.message,
					secret: request.secret,
					kind: request.kind,
					defaultValue: request.defaultValue,
					choices: request.choices,
				}),
		);
		this.core = new Versobs(this.app, this, bridge, jobs);
		this.host = new ModuleHost(this.core, MODULES);

		this.registerView(JOBS_VIEW, (leaf) => new JobsView(leaf, this.core));
		this.statusBar = new StatusBar(this.addStatusBarItem(), this.core, () => void this.openJobs());
		this.registerEvent(bridge.on("change", () => this.statusBar.update()));
		this.registerEvent(jobs.on("change", () => this.statusBar.update()));
		this.registerEvent(
			jobs.on("finished", (...data: unknown[]) => {
				const job = data[0] as Job;
				this.notifyFinished(job);
				if (job.detached && job.status === "success") void this.core.finishDetached(job);
			}),
		);

		const pluginDir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		const store = new JobStore(this.app.vault.adapter, `${pluginDir}/jobs.json`, () => jobs.jobs, (tool) => bridge.tool(tool));
		jobs.restore(await store.load());
		this.jobStore = store;
		this.registerEvent(jobs.on("change", () => store.schedule()));

		this.addRibbonIcon("audio-waveform", t("ribbon.jobs"), () => void this.openJobs());
		this.addCommand({ id: "open-jobs", name: t("cmd.openJobs"), callback: () => void this.openJobs() });
		this.addCommand({
			id: "check-versline",
			name: t("cmd.checkVersline"),
			callback: async () => {
				await bridge.refresh();
				if (bridge.state === "ready") new Notice(t("status.ready", { version: bridge.manifest?.versline ?? "" }));
				else this.core.openSetup();
			},
		});
		this.addCommand({ id: "cancel-all", name: t("cmd.cancelAll"), callback: () => jobs.cancelAll() });

		this.addSettingTab(new VersobsSettingTab(this));
		this.host.loadAll();

		this.app.workspace.onLayoutReady(() => {
			void bridge.refresh().then(() => {
				if (this.settings.checkUpdates && bridge.state === "ready") void this.checkPluginUpdate(false);
			});
		});
	}

	override onunload(): void {
		this.core?.jobs.dispose();
		void this.jobStore?.save();
		this.host?.unloadAll();
	}

	override async onExternalSettingsChange(): Promise<void> {
		this.settings = migrateSettings(await this.loadData());
		setLanguage(resolveLanguage(this.settings.language, getLanguage()));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	openSettings(): void {
		const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}

	async openJobs(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(JOBS_VIEW)[0];
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		await leaf?.setViewState({ type: JOBS_VIEW, active: true });
		if (leaf) await this.app.workspace.revealLeaf(leaf);
	}

	private notifyFinished(job: Job): void {
		if (!this.settings.notifyOnFinish && job.status === "success") return;
		const fragment = createFragment();
		if (job.status === "success") fragment.append(t("notice.done", { title: job.title }));
		else if (job.status === "cancelled") fragment.append(t("notice.cancelled", { title: job.title }));
		else {
			fragment.append(t("notice.failed", { title: job.title }));
			const reason = job.outcome?.error?.message;
			if (reason) fragment.append(createEl("br"), reason.slice(0, 300));
		}
		if (job.status === "error") {
			const link = createEl("a", { text: " " + t("notice.details") });
			link.addEventListener("click", () => void this.openJobs());
			fragment.append(createEl("br"), link);
		}
		new Notice(fragment, job.status === "error" ? 12000 : 5000);
	}

	/** Ask Versline whether a newer plugin release exists; offer to install it into this vault. */
	async checkPluginUpdate(interactive: boolean): Promise<void> {
		const bridge = this.core.bridge;
		if (!(await bridge.ready()) || !bridge.has("obsidian.status")) {
			if (interactive) this.core.openSetup();
			return;
		}
		let status: PluginStatus;
		try {
			status = await bridge.call<PluginStatus>("obsidian.status", { vault: this.core.paths.base() });
		} catch (err) {
			if (interactive) new Notice(t("update.checkFailed", { error: String((err as Error).message ?? err) }), 8000);
			return;
		}
		if (status.error) {
			if (interactive) new Notice(t("update.checkFailed", { error: status.error }), 8000);
			return;
		}
		const current = this.manifest.version;
		const newer = status.latest && compareVersions(status.latest, current) > 0;
		if (!newer) {
			if (interactive) new Notice(t("update.pluginLatest", { version: current }));
			return;
		}
		new ConfirmationModal(this.app)
			.setTitle(t("update.pluginTitle"))
			.setContent(t("update.pluginBody", { current, latest: status.latest ?? "" }))
			.addButton((b) =>
				b
					.setButtonText(t("update.install"))
					.setCta()
					.onClick(() => void this.installPluginUpdate()),
			)
			.addCancelButton(t("update.later"))
			.open();
	}

	private async installPluginUpdate(): Promise<void> {
		const result = await this.core.runTool({
			tool: "obsidian.install",
			title: t("update.pluginTitle"),
			values: { vault: this.core.paths.base() },
			skipForm: true,
			remember: false,
		});
		if (result?.outcome.status !== "success") return;
		const data = result.outcome.data as unknown as InstallResult;
		new Notice(t("update.pluginInstalled", { version: data.version }), 10000);
	}

	async checkVerslineUpdate(interactive: boolean): Promise<void> {
		const bridge = this.core.bridge;
		if (!(await bridge.ready())) {
			if (interactive) this.core.openSetup();
			return;
		}
		let info: VerslineUpdate;
		try {
			info = await bridge.call<VerslineUpdate>("system.check_update");
		} catch (err) {
			if (interactive) new Notice(t("update.checkFailed", { error: String((err as Error).message ?? err) }), 8000);
			return;
		}
		if (!info.update_available) {
			if (interactive) new Notice(t("update.verslineLatest", { version: info.current }));
			return;
		}
		new ConfirmationModal(this.app)
			.setTitle(t("update.verslineTitle"))
			.setContent(t("update.verslineBody", { current: info.current, latest: info.latest }))
			.addButton((b) =>
				b
					.setButtonText(t("update.install"))
					.setCta()
					.onClick(async () => {
						const result = await this.core.runTool({
							tool: "system.update",
							title: t("update.verslineTitle"),
							skipForm: true,
							remember: false,
						});
						if (result?.outcome.status === "success") {
							new Notice(t("update.verslineDone"), 10000);
							await bridge.refresh();
						}
					}),
			)
			.addCancelButton(t("update.later"))
			.open();
	}
}

export function compareVersions(a: string, b: string): number {
	const parse = (v: string) => v.replace(/^v/i, "").split(".").map((p) => parseInt(p, 10) || 0);
	const x = parse(a);
	const y = parse(b);
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const diff = (x[i] ?? 0) - (y[i] ?? 0);
		if (diff) return diff;
	}
	return 0;
}
