// Sidebar panel listing running and finished jobs: progress, logs, cost, cancel, open results.
import { ItemView, type IconName, ProgressBarComponent, setIcon, setTooltip, type WorkspaceLeaf } from "obsidian";
import { applyDirection, formatDuration, formatNumber, pick, t } from "../i18n";
import type { Versobs } from "../core/versobs";
import type { Job, JobStatus } from "./job-manager";

export const JOBS_VIEW = "versobs-jobs";

const STATUS_ICON: Record<JobStatus, IconName> = {
	queued: "clock",
	running: "loader",
	success: "check-circle",
	error: "alert-circle",
	cancelled: "x-circle",
};

export class JobsView extends ItemView {
	private expanded = new Set<number>();
	private renderQueued = false;
	private timer: number | null = null;

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
		this.registerEvent(this.core.jobs.on("change", () => this.queueRender()));
		this.timer = window.setInterval(() => {
			if (this.core.jobs.running.length) this.queueRender();
		}, 1000);
		this.registerInterval(this.timer);
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
		const root = this.contentEl;
		root.empty();
		root.addClass("versobs-jobs");
		applyDirection(root);

		const header = root.createDiv({ cls: "versobs-jobs-header" });
		header.createEl("h4", { text: t("jobs.title") });
		const actions = header.createDiv({ cls: "versobs-jobs-actions" });
		this.iconButton(actions, "trash-2", t("jobs.clear"), () => this.core.jobs.clearFinished());
		this.iconButton(actions, "refresh-cw", t("jobs.checkVersline"), () => void this.core.bridge.refresh());

		const jobs = this.core.jobs.jobs;
		if (!jobs.length) {
			root.createDiv({ cls: "versobs-empty", text: t("jobs.empty") });
			return;
		}
		for (const job of jobs) this.renderJob(root, job);
	}

	private renderJob(root: HTMLElement, job: Job): void {
		const card = root.createDiv({ cls: `versobs-job is-${job.status}` });
		const head = card.createDiv({ cls: "versobs-job-head" });
		const icon = head.createSpan({ cls: "versobs-job-icon" });
		setIcon(icon, STATUS_ICON[job.status]);
		const titleEl = head.createDiv({ cls: "versobs-job-title", text: job.title });
		titleEl.addEventListener("click", () => {
			if (this.expanded.has(job.id)) this.expanded.delete(job.id);
			else this.expanded.add(job.id);
			this.render();
		});
		head.createSpan({ cls: "versobs-job-time", text: this.elapsed(job) });
		if (job.status === "running" || job.status === "queued") {
			this.iconButton(head, "square", t("jobs.cancel"), () => this.core.jobs.cancel(job));
		}

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

		if (job.status === "error" && job.outcome?.error) {
			card.createDiv({ cls: "versobs-job-error", text: job.outcome.error.message });
		}
		if (job.cost && (job.cost.usd || job.cost.irt || job.cost.input_tokens)) {
			card.createDiv({ cls: "versobs-job-cost", text: costText(job) });
		}

		const outputs = job.outcome?.artifacts.filter((a) => a.exists) ?? [];
		if (outputs.length) {
			const list = card.createDiv({ cls: "versobs-job-outputs" });
			for (const artifact of outputs.slice(0, 8)) {
				const vaultPath = this.core.paths.toVault(artifact.path);
				const link = list.createEl("a", { text: (vaultPath ?? artifact.path).split(/[\\/]/).pop() ?? artifact.path });
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

		if (this.expanded.has(job.id) && job.logs.length) {
			const logs = card.createEl("pre", { cls: "versobs-job-logs", attr: { dir: "auto" } });
			logs.setText(
				job.logs
					.slice(-200)
					.map((l) => (l.level === "info" ? l.message : `[${l.level}] ${l.message}`))
					.join("\n"),
			);
		}
	}

	private elapsed(job: Job): string {
		if (!job.startedAt) return t("jobs.queued");
		return formatDuration((job.endedAt ?? Date.now()) - job.startedAt);
	}

	private iconButton(parent: HTMLElement, icon: IconName, label: string, onClick: () => void): void {
		const button = parent.createEl("button", { cls: "clickable-icon versobs-icon-button", attr: { "aria-label": label } });
		setIcon(button, icon);
		button.addEventListener("click", (evt) => {
			evt.stopPropagation();
			onClick();
		});
	}
}

export function costText(job: Job): string {
	const cost = job.cost;
	if (!cost) return "";
	const parts = [t("jobs.tokens", { input: cost.input_tokens, output: cost.output_tokens })];
	if (cost.usd) parts.push(`$${cost.usd.toFixed(4)}`);
	if (cost.irt) parts.push(t("jobs.irt", { amount: Math.round(cost.irt) }));
	return parts.join(" · ");
}

export function toolTitle(core: Versobs, tool: string): string {
	return pick(core.bridge.tool(tool)?.title, tool);
}
