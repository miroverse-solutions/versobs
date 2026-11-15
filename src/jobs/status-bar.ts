// Status bar item: Versline state and the number of running jobs; click opens the jobs panel.
import { setIcon, setTooltip } from "obsidian";
import { formatNumber, t } from "../i18n";
import type { Versobs } from "../core/versobs";

export class StatusBar {
	constructor(
		private el: HTMLElement,
		private core: Versobs,
		onClick: () => void,
	) {
		el.addClass("versobs-status", "mod-clickable");
		el.addEventListener("click", onClick);
		this.update();
	}

	update(): void {
		const { bridge, jobs } = this.core;
		this.el.empty();
		const icon = this.el.createSpan({ cls: "versobs-status-icon" });
		const running = jobs.running.length;
		const queued = jobs.active.length - running;
		if (running) {
			setIcon(icon, "loader");
			this.el.createSpan({ text: ` ${formatNumber(running)}${queued ? `+${formatNumber(queued)}` : ""}` });
			setTooltip(this.el, t("status.running", { count: running }));
			return;
		}
		const state = bridge.state;
		setIcon(icon, state === "ready" ? "audio-waveform" : state === "checking" ? "loader" : "alert-triangle");
		this.el.toggleClass("is-warning", state === "missing" || state === "outdated" || state === "error");
		setTooltip(
			this.el,
			state === "ready"
				? t("status.ready", { version: bridge.manifest?.versline ?? "" })
				: state === "checking"
					? t("status.checking")
					: state === "missing"
						? t("status.missing")
						: state === "outdated"
							? t("status.outdated")
							: t("status.error"),
		);
	}
}
