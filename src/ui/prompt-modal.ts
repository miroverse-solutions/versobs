// Answers a `prompt` event from a running job (e.g. the Telegram login code).
import { type App, Modal, Setting } from "obsidian";
import { applyDirection, type MessageKey, t } from "../i18n";

const KIND_KEYS: Record<string, MessageKey> = {
	phone: "prompt.phone",
	code: "prompt.code",
	password: "prompt.password",
	api_id: "prompt.apiId",
	api_hash: "prompt.apiHash",
};

export interface PromptOptions {
	jobTitle: string;
	message: string;
	secret: boolean;
	kind: string | null;
	defaultValue: string | null;
	choices: string[] | null;
}

export class PromptModal extends Modal {
	private value = "";
	private answered = false;

	constructor(
		app: App,
		private options: PromptOptions,
		private resolve: (value: string | null) => void,
	) {
		super(app);
		this.value = options.defaultValue ?? "";
	}

	override onOpen(): void {
		const { contentEl, options } = this;
		applyDirection(this.modalEl);
		this.setTitle(options.jobTitle);
		const key = options.kind ? KIND_KEYS[options.kind] : undefined;
		contentEl.createEl("p", { text: key ? t(key) : options.message });
		if (key && options.message) contentEl.createEl("p", { text: options.message, cls: "versobs-muted" });

		const submit = () => {
			this.answered = true;
			this.resolve(this.value);
			this.close();
		};

		if (options.kind === "confirm" || (options.choices && options.choices.length)) {
			const setting = new Setting(contentEl);
			setting.addButton((b) =>
				b
					.setButtonText(t("common.yes"))
					.setCta()
					.onClick(() => {
						this.value = options.choices?.[0] ?? "y";
						submit();
					}),
			);
			setting.addButton((b) =>
				b.setButtonText(t("common.no")).onClick(() => {
					this.value = options.choices?.[1] ?? "n";
					submit();
				}),
			);
			return;
		}

		new Setting(contentEl).addText((text) => {
			text.setValue(this.value).onChange((v) => (this.value = v));
			if (options.secret) text.inputEl.type = "password";
			text.inputEl.addClass("versobs-wide-input");
			text.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") {
					evt.preventDefault();
					submit();
				}
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});
		new Setting(contentEl)
			.addButton((b) => b.setButtonText(t("common.ok")).setCta().onClick(submit))
			.addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()));
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.answered) this.resolve(null);
	}
}

export function askUser(app: App, options: PromptOptions): Promise<string | null> {
	return new Promise((resolve) => new PromptModal(app, options, resolve).open());
}
