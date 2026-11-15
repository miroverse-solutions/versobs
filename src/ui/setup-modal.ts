// Shown when Versline is missing, too old, or failing: what to do, with the install command to copy.
import { type App, Modal, Notice, Setting } from "obsidian";
import { installCommand } from "../bridge/locator";
import type { BridgeService } from "../core/bridge-service";
import { applyDirection, t } from "../i18n";

export class SetupModal extends Modal {
	constructor(
		app: App,
		private bridge: BridgeService,
		private openSettings: () => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl, bridge } = this;
		applyDirection(this.modalEl);
		this.setTitle(t("setup.title"));
		const state = bridge.state;
		const message =
			state === "outdated" ? t("setup.outdated") : state === "error" ? t("setup.error") : t("setup.missing");
		contentEl.createEl("p", { text: message });
		if (state === "error" && bridge.error) {
			contentEl.createEl("pre", { text: bridge.error, cls: "versobs-error-box" });
		}

		const command = state === "outdated" ? "versline update" : installCommand();
		contentEl.createEl("p", { text: state === "outdated" ? t("setup.runUpdate") : t("setup.runInstall") });
		const pre = contentEl.createEl("pre", { cls: "versobs-command", attr: { dir: "ltr" } });
		pre.createEl("code", { text: command });
		if (state !== "outdated") {
			contentEl.createEl("p", { text: t("setup.thenInit"), cls: "versobs-muted" });
			contentEl.createEl("pre", { cls: "versobs-command", attr: { dir: "ltr" } }).createEl("code", { text: "versline init" });
		}

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText(t("setup.copy")).onClick(async () => {
					await navigator.clipboard.writeText(command);
					new Notice(t("setup.copied"));
				}),
			)
			.addButton((b) =>
				b
					.setButtonText(t("setup.checkAgain"))
					.setCta()
					.onClick(async () => {
						await bridge.refresh();
						if (bridge.state === "ready") {
							new Notice(t("status.ready", { version: bridge.manifest?.versline ?? "" }));
							this.close();
						} else {
							this.contentEl.empty();
							this.onOpen();
						}
					}),
			)
			.addButton((b) =>
				b.setButtonText(t("setup.openSettings")).onClick(() => {
					this.close();
					this.openSettings();
				}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
