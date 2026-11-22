// Sidebar panel: running and finished jobs (progress, logs, cost, cancel, retry, open results) and a "New job" launcher.
// The header, job list and launcher render separately, so a job update never disturbs the search box or open logs.
import {
	ItemView,
	type IconName,
	Menu,
	Notice,
	ProgressBarComponent,
	setIcon,
	setTooltip,
	type WorkspaceLeaf,
} from "obsidian";
import { applyDirection, formatDuration, formatNumber, pick, t } from "../i18n";
import type { Versobs } from "../core/versobs";
import { addCost, canRetry, isActive, type Job, type JobStatus } from "./job-manager";
import { resultWarnings, warningText } from "./warnings";
import { LauncherPanel } from "./launcher-panel";

export const JOBS_VIEW = "versobs-jobs";

const STATUS_ICON: Record<JobStatus, IconName> = {
	queued: "clock",
	running: "loader",
	success: "check-circle",
	error: "alert-circle",
	cancelled: "x-circle",
	interrupted: "pause-circle",
};

export class JobsView extends ItemView {
	private expanded = new Set<number>();
	private renderQueued = false;
	private headerEl!: HTMLElement;
	private listEl!: HTMLElement;
	private launcher!: LauncherPanel;
	/** Elapsed-time labels of running jobs, updated every second without re-rendering. */
	private timeEls = new Map<number, { el: HTMLElement; job: Job }>();
	private logScroll = new Map<number, { top: number; atBottom: boolean }>();

	constructor(
		leaf: WorkspaceLeaf,
		private core: Versobs,
	) {
		super(leaf);
	}

	getViewType(): string {
		return JOBS_VIEW;
	}

	getDisplayText(): string {
		return t("jobs.title");
	}

	override getIcon(): IconName {
		return "list-checks";
	}

	override async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("versobs-jobs");
		applyDirection(root);
		this.headerEl = root.createDiv({ cls: "versobs-jobs-header" });
		this.listEl = root.createDiv({ cls: "versobs-jobs-list" });
		this.launcher = new LauncherPanel(root, this.core, this.app);

		this.registerEvent(this.core.jobs.on("change", () => this.queueRender()));
		this.registerEvent(
			this.core.bridge.on("change", () => {
				this.queueRender();
				this.launcher.refresh();
			}),
		);
		this.registerEvent(this.core.launchers.on("change", () => this.launcher.refresh()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.launcher.refresh()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.launcher.refresh()));
		this.registerInterval(
			window.setInterval(() => {
				for (const { el, job } of this.timeEls.values()) if (job.status === "running") el.setText(this.elapsed(job));
			}, 1000),
		);
		this.render();
	}

	private queueRender(): void {
		if (this.renderQueued) return;
		this.renderQueued = true;
		window.requestAnimationFrame(() => {
			this.renderQueued = false;
			this.render();
		});
	}

	render(): void {
		if (!this.listEl) return;
		this.renderHeader();
		this.renderList();
	}

	private renderHeader(): void {
		const header = this.headerEl;
		header.empty();
		const { bridge, jobs } = this.core;
		const top = header.createDiv({ cls: "versobs-jobs-title-row" });
		const state = bridge.state;
		const dot = top.createSpan({
			cls: `versobs-status-dot is-${state === "ready" ? "ready" : state === "checking" || state === "unknown" ? "checking" : "warning"}`,
		});
		setTooltip(dot, this.statusText());
		top.createEl("h4", { text: t("jobs.title") });
		const actions = top.createDiv({ cls: "versobs-jobs-actions" });
		if (jobs.active.length) this.iconButton(actions, "square", t("jobs.cancelAll"), () => jobs.cancelAll());
		const clear = this.iconButton(actions, "trash-2", t("jobs.clear"), () => jobs.clearFinished());
		if (jobs.jobs.every(isActive)) clear.setAttribute("disabled", "true");
		this.iconButton(actions, "refresh-cw", t("jobs.checkVersline"), () => void bridge.refresh());

		if (jobs.jobs.length) {
			const running = jobs.running.length;
			const queued = jobs.active.length - running;
			const finished = jobs.jobs.length - jobs.active.length;
			header.createDiv({
				cls: "versobs-jobs-summary",
				text: jobs.active.length
					? t("jobs.summary", { running: formatNumber(running), queued: formatNumber(queued), finished: formatNumber(finished) })
					: t("jobs.summaryIdle", { finished: formatNumber(finished) }),
			});
		}
	}

	private statusText(): string {
		const bridge = this.core.bridge;
		switch (bridge.state) {
			case "ready":
				return t("status.ready", { version: bridge.manifest?.versline ?? "" });
			case "missing":
				return t("status.missing");
			case "outdated":
				return t("status.outdated");
			case "error":
				return t("status.error");
			default:
				return t("status.checking");
		}
	}

	private renderList(): void {
		const list = this.listEl;
		const scrollTop = list.scrollTop;
		for (const pre of Array.from(list.querySelectorAll<HTMLElement>("pre[data-job]"))) {
			this.logScroll.set(Number(pre.dataset.job), {
				top: pre.scrollTop,
				atBottom: pre.scrollHeight - pre.scrollTop - pre.clientHeight < 8,
			});
		}
		list.empty();
		this.timeEls.clear();

		const jobs = this.core.jobs.jobs;
		if (!jobs.length) {
			const empty = list.createDiv({ cls: "versobs-empty" });
			setIcon(empty.createDiv({ cls: "versobs-empty-icon" }), "list-checks");
			empty.createDiv({ text: t("jobs.empty") });
			return;
		}
		const active = jobs.filter(isActive);
		const finished = jobs.filter((j) => !isActive(j));
		this.section(list, t("jobs.active"), active);
		this.section(list, t("jobs.finished"), finished);
		list.scrollTop = scrollTop;
	}

	private section(root: HTMLElement, title: string, jobs: Job[]): void {
		if (!jobs.length) return;
		root.createDiv({ cls: "versobs-jobs-section", text: `${title} (${formatNumber(jobs.length)})` });
		for (const job of jobs) this.renderJob(root, job);
	}

	private renderJob(root: HTMLElement, job: Job): void {
		const open = this.expanded.has(job.id);
		const card = root.createDiv({ cls: `versobs-job is-${job.status}` });
		card.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			this.jobMenu(job).showAtMouseEvent(evt);
		});
		const head = card.createDiv({ cls: "versobs-job-head" });
		const toggle = head.createEl("button", {
			cls: "clickable-icon versobs-icon-button versobs-job-toggle",
			attr: { "aria-label": t("jobs.details"), "aria-expanded": String(open) },
		});
		setIcon(toggle, open ? "chevron-down" : "chevron-right");
		const flip = () => {
			if (this.expanded.has(job.id)) this.expanded.delete(job.id);
			else this.expanded.add(job.id);
			this.renderList();
		};
		toggle.addEventListener("click", flip);
		setIcon(head.createSpan({ cls: "versobs-job-icon" }), STATUS_ICON[job.status]);
		const titleEl = head.createDiv({ cls: "versobs-job-title", text: job.title });
		setTooltip(titleEl, job.title);
		titleEl.addEventListener("click", flip);
		const time = head.createSpan({ cls: "versobs-job-time", text: this.elapsed(job) });
		this.timeEls.set(job.id, { el: time, job });
		if (canRetry(job)) {
			const label = job.status === "interrupted" ? t("jobs.continue") : t("jobs.retry");
			this.iconButton(head, job.status === "interrupted" ? "play" : "rotate-ccw", label, () => void this.core.retryJob(job));
		}
		if (isActive(job)) this.iconButton(head, "square", t("jobs.cancel"), () => this.core.jobs.cancel(job));
		const more = this.iconButton(head, "more-horizontal", t("jobs.more2"), () => undefined);
		more.addEventListener("click", (evt) => this.jobMenu(job).showAtMouseEvent(evt));

		if (job.status === "running") {
			const progress = job.progress;
			const label = card.createDiv({ cls: "versobs-job-label", text: progress?.label ?? t("jobs.working") });
			if (progress?.total) {
				const percent = Math.max(0, Math.min(100, ((progress.current ?? 0) / progress.total) * 100));
				new ProgressBarComponent(card.createDiv()).setValue(percent);
				label.appendText(` · ${formatNumber(Math.round(percent))}%`);
			} else {
				card.createDiv({ cls: "versobs-indeterminate" });
			}
		}
		if (job.status === "queued") {
			const pos = this.core.jobs.queuePosition(job);
			if (pos) card.createDiv({ cls: "versobs-job-label", text: t("jobs.queuePos", { pos: formatNumber(pos) }) });
		}
		if (job.status === "error" && job.outcome?.error) {
			card.createDiv({ cls: "versobs-job-error", text: job.outcome.error.message });
		}
		if (job.status === "success") {
			for (const warning of resultWarnings(job.outcome?.data)) {
				card.createDiv({ cls: "versobs-job-warning", text: `⚠️ ${warningText(warning)}`, attr: { dir: "auto" } });
			}
		}
		if (job.status === "interrupted") {
			card.createDiv({ cls: "versobs-job-label", text: t("jobs.interrupted") });
		}
		const cost = addCost(job.priorCost, job.cost);
		if (cost && (cost.usd || cost.irt || cost.input_tokens)) {
			card.createDiv({ cls: "versobs-job-cost", text: costText(job) });
		}
		this.renderOutputs(card, job);
		if (open) this.renderDetails(card, job);
	}

	private renderOutputs(card: HTMLElement, job: Job): void {
		const outputs = job.outcome?.artifacts.filter((a) => a.exists) ?? [];
		if (!outputs.length) return;
		const list = card.createDiv({ cls: "versobs-job-outputs" });
		for (const artifact of outputs.slice(0, 8)) {
			const vaultPath = this.core.paths.toVault(artifact.path);
			const name = (vaultPath ?? artifact.path).split(/[\\/]/).pop() ?? artifact.path;
			const link = list.createEl("a", { cls: "versobs-job-output" });
			setIcon(link.createSpan({ cls: "versobs-job-output-icon" }), outputIcon(artifact.path));
			link.createSpan({ text: name });
			setTooltip(link, vaultPath ?? artifact.path);
			link.addEventListener("click", (evt) => {
				evt.preventDefault();
				if (vaultPath !== null && /\.md$/i.test(artifact.path)) {
					void this.app.workspace.openLinkText(vaultPath, "", true);
				} else {
					void this.core.openExternal(artifact.path);
				}
			});
		}
		if (outputs.length > 8) list.createSpan({ text: t("jobs.more", { count: outputs.length - 8 }) });
	}

	private renderDetails(card: HTMLElement, job: Job): void {
		const details = card.createDiv({ cls: "versobs-job-details" });
		const meta = [job.tool];
		if (job.startedAt) meta.push(new Date(job.startedAt).toLocaleTimeString());
		details.createDiv({ cls: "versobs-job-meta", text: meta.join(" · ") });
		if (!job.logs.length) {
			details.createDiv({ cls: "versobs-job-label", text: t("jobs.noLogs") });
			return;
		}
		const logs = details.createEl("pre", { cls: "versobs-job-logs", attr: { dir: "auto", "data-job": String(job.id) } });
		logs.setText(logText(job));
		const saved = this.logScroll.get(job.id);
		logs.scrollTop = !saved || saved.atBottom ? logs.scrollHeight : saved.top;
		const actions = details.createDiv({ cls: "versobs-job-detail-actions" });
		const copy = actions.createEl("button", { text: t("jobs.copyLogs") });
		copy.addEventListener("click", () => this.copy(logText(job, job.logs.length)));
		if (job.outcome?.error?.message) {
			const message = job.outcome.error.message;
			actions.createEl("button", { text: t("jobs.copyError") }).addEventListener("click", () => this.copy(message));
		}
	}

	private jobMenu(job: Job): Menu {
		const menu = new Menu();
		if (canRetry(job)) {
			const interrupted = job.status === "interrupted";
			menu.addItem((i) =>
				i
					.setTitle(interrupted ? t("jobs.continue") : t("jobs.retry"))
					.setIcon(interrupted ? "play" : "rotate-ccw")
					.onClick(() => void this.core.retryJob(job)),
			);
		}
		if (isActive(job)) {
			menu.addItem((i) => i.setTitle(t("jobs.cancel")).setIcon("square").onClick(() => this.core.jobs.cancel(job)));
		}
		if (job.sourcePath && this.app.vault.getFileByPath(job.sourcePath)) {
			const path = job.sourcePath;
			menu.addItem((i) =>
				i
					.setTitle(t("jobs.openSource"))
					.setIcon("file-text")
					.onClick(() => void this.app.workspace.openLinkText(path, "", true)),
			);
		}
		const output = job.outcome?.artifacts.find((a) => a.exists);
		if (output) {
			menu.addItem((i) =>
				i.setTitle(t("jobs.showInFolder")).setIcon("folder-open").onClick(() => this.core.showInFolder(output.path)),
			);
		}
		if (job.logs.length) {
			menu.addItem((i) => i.setTitle(t("jobs.copyLogs")).setIcon("copy").onClick(() => this.copy(logText(job, job.logs.length))));
		}
		const error = job.outcome?.error?.message;
		if (error) menu.addItem((i) => i.setTitle(t("jobs.copyError")).setIcon("copy").onClick(() => this.copy(error)));
		if (!isActive(job)) {
			menu.addSeparator();
			menu.addItem((i) => i.setTitle(t("jobs.remove")).setIcon("trash-2").onClick(() => this.core.jobs.remove(job)));
		}
		return menu;
	}

	private copy(text: string): void {
		void navigator.clipboard.writeText(text).then(() => new Notice(t("jobs.copied"), 1500));
	}

	private elapsed(job: Job): string {
		const attempt = job.attempts > 1 ? `${t("jobs.attempt", { count: job.attempts })} · ` : "";
		if (!job.startedAt) return attempt + t("jobs.queued");
		return attempt + formatDuration((job.endedAt ?? Date.now()) - job.startedAt);
	}

	private iconButton(parent: HTMLElement, icon: IconName, label: string, onClick: () => void): HTMLButtonElement {
		const button = parent.createEl("button", { cls: "clickable-icon versobs-icon-button", attr: { "aria-label": label } });
		setIcon(button, icon);
		button.addEventListener("click", (evt) => {
			evt.stopPropagation();
			onClick();
		});
		return button;
	}
}

function logText(job: Job, count = 200): string {
	return job.logs
		.slice(-count)
		.map((l) => (l.level === "info" ? l.message : `[${l.level}] ${l.message}`))
		.join("\n");
}

function outputIcon(path: string): IconName {
	if (/\.md$/i.test(path)) return "file-text";
	if (/\.(docx?|pdf)$/i.test(path)) return "file-type";
	if (/\.html?$/i.test(path)) return "presentation";
	if (/\.(csv|xlsx?)$/i.test(path)) return "table";
	return /\.[a-z0-9]{1,5}$/i.test(path) ? "file" : "folder";
}

/** Cost of all attempts of the job. */
export function costText(job: Job): string {
	const cost = addCost(job.priorCost, job.cost);
	if (!cost) return "";
	const parts = [t("jobs.tokens", { input: cost.input_tokens, output: cost.output_tokens })];
	if (cost.usd) parts.push(`$${cost.usd.toFixed(4)}`);
	if (cost.irt) parts.push(t("jobs.irt", { amount: Math.round(cost.irt) }));
	return parts.join(" · ");
}

export function toolTitle(core: Versobs, tool: string): string {
	return pick(core.bridge.tool(tool)?.title, tool);
}
