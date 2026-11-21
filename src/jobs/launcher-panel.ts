// "New job" section at the bottom of the jobs panel: search the available tasks and start one with a click or Enter.
// The panel keeps its own DOM, so job updates never reset the search box.
import { type App, SearchComponent, setIcon } from "obsidian";
import { type Launcher, groupLaunchers } from "../core/launchers";
import type { Versobs } from "../core/versobs";
import { t } from "../i18n";

export class LauncherPanel {
	private bodyEl!: HTMLElement;
	private listEl!: HTMLElement;
	private chevron!: HTMLElement;
	private search!: SearchComponent;
	private query = "";
	private highlighted = -1;
	/** Launchers in the order they are shown (for arrow keys). */
	private visible: Launcher[] = [];

	constructor(
		private parent: HTMLElement,
		private core: Versobs,
		private app: App,
	) {
		this.build();
		this.refresh();
	}

	private build(): void {
		const root = this.parent.createDiv({ cls: "versobs-launcher" });
		const head = root.createEl("button", {
			cls: "versobs-launcher-head clickable-icon",
			attr: { "aria-label": t("jobs.newJob") },
		});
		this.chevron = head.createSpan({ cls: "versobs-launcher-chevron" });
		setIcon(head.createSpan({ cls: "versobs-launcher-plus" }), "plus-circle");
		head.createSpan({ cls: "versobs-launcher-title", text: t("jobs.newJob") });
		head.addEventListener("click", () => {
			this.core.settings.jobsLauncherOpen = !this.core.settings.jobsLauncherOpen;
			this.applyOpen();
			void this.core.save();
			if (this.core.settings.jobsLauncherOpen) this.search.inputEl.focus();
		});

		this.bodyEl = root.createDiv({ cls: "versobs-launcher-body" });
		this.search = new SearchComponent(this.bodyEl.createDiv({ cls: "versobs-launcher-search" }));
		this.search.setPlaceholder(t("jobs.search"));
		this.search.onChange((value) => {
			this.query = value;
			this.highlighted = value.trim() ? 0 : -1;
			this.refresh();
		});
		this.search.inputEl.addEventListener("keydown", (evt) => this.onKey(evt));
		this.listEl = this.bodyEl.createDiv({ cls: "versobs-launcher-list", attr: { role: "listbox" } });
		this.applyOpen();
	}

	private applyOpen(): void {
		const open = this.core.settings.jobsLauncherOpen;
		this.bodyEl.toggleClass("is-hidden", !open);
		setIcon(this.chevron, open ? "chevron-down" : "chevron-right");
		this.chevron.parentElement?.setAttribute("aria-expanded", String(open));
	}

	/** Re-render the task list (not the search box). */
	refresh(): void {
		this.listEl.empty();
		const groups = groupLaunchers(this.core.launchers.list, this.query);
		this.visible = [];

		const bridge = this.core.bridge;
		if (bridge.state === "missing" || bridge.state === "outdated" || bridge.state === "error") {
			const warn = this.listEl.createDiv({ cls: "versobs-launcher-warning" });
			warn.createSpan({ text: t("jobs.notReady") + " " });
			const link = warn.createEl("a", { text: t("jobs.setup") });
			link.addEventListener("click", (evt) => {
				evt.preventDefault();
				this.core.openSetup();
			});
		}

		const file = this.app.workspace.getActiveFile();
		this.group(file ? t("jobs.forFile", { name: file.name }) : t("jobs.forNoFile"), groups.forFile);
		this.group(t("jobs.allTasks"), groups.general);
		this.group(null, groups.tools, t("jobs.allTools"));

		if (!this.visible.length) this.listEl.createDiv({ cls: "versobs-launcher-empty", text: t("jobs.noMatch") });
		this.highlighted = Math.min(this.highlighted, this.visible.length - 1);
		this.paintHighlight();
	}

	private group(title: string | null, items: Launcher[], nameOverride?: string): void {
		if (!items.length) return;
		if (title) this.listEl.createDiv({ cls: "versobs-launcher-group", text: title });
		for (const item of items) {
			const index = this.visible.length;
			this.visible.push(item);
			const row = this.listEl.createDiv({
				cls: "versobs-launcher-row",
				attr: { role: "option", tabindex: "0", "aria-label": nameOverride ?? item.name },
			});
			setIcon(row.createSpan({ cls: "versobs-launcher-icon" }), item.icon);
			row.createSpan({ cls: "versobs-launcher-name", text: nameOverride ?? item.name });
			row.dataset.index = String(index);
			row.addEventListener("click", () => this.start(item));
			row.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter" || evt.key === " ") {
					evt.preventDefault();
					this.start(item);
				}
			});
		}
	}

	private paintHighlight(): void {
		this.listEl.querySelectorAll<HTMLElement>(".versobs-launcher-row").forEach((row) => {
			const active = Number(row.dataset.index) === this.highlighted;
			row.toggleClass("is-selected", active);
			if (active) row.scrollIntoView({ block: "nearest" });
		});
	}

	private onKey(evt: KeyboardEvent): void {
		if (evt.key === "ArrowDown" || evt.key === "ArrowUp") {
			evt.preventDefault();
			if (!this.visible.length) return;
			const step = evt.key === "ArrowDown" ? 1 : -1;
			const next = this.highlighted + step;
			this.highlighted = Math.min(this.visible.length - 1, Math.max(0, this.highlighted < 0 && step < 0 ? 0 : next));
			this.paintHighlight();
		} else if (evt.key === "Enter") {
			evt.preventDefault();
			const launcher = this.visible[this.highlighted < 0 && this.visible.length === 1 ? 0 : this.highlighted];
			if (launcher) this.start(launcher);
		} else if (evt.key === "Escape" && this.query) {
			evt.preventDefault();
			evt.stopPropagation();
			this.clearSearch();
		}
	}

	private clearSearch(): void {
		this.search.setValue("");
		this.query = "";
		this.highlighted = -1;
		this.refresh();
	}

	private start(launcher: Launcher): void {
		this.clearSearch();
		launcher.run();
	}
}
