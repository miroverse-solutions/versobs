// A form generated from a tool's parameter schema (bilingual labels and widget hints come from Versline).
// This is what lets any new Versline tool be used from Obsidian without plugin changes.
import { type App, Modal, Notice, Setting } from "obsidian";
import type { ParamSchema, ToolSpec } from "../bridge/protocol";
import { asText, coerce, type Field, fieldsOf, missingRequired } from "../bridge/schema";
import { applyDirection, joinList, pick, t } from "../i18n";
import { PathSuggest } from "./file-suggest";

export interface FormOptions {
	spec: ToolSpec;
	values: Record<string, unknown>;
	/** Fields filled by the caller and not shown. */
	hidden?: string[];
	title?: string;
	submitText?: string;
	/** Extra text above the fields. */
	intro?: string;
}

export class SchemaFormModal extends Modal {
	private values: Record<string, unknown>;
	private submitted = false;
	/** Commit text typed into list inputs but not yet added with Enter. */
	private pending: Array<() => void> = [];

	constructor(
		app: App,
		private options: FormOptions,
		private resolve: (values: Record<string, unknown> | null) => void,
	) {
		super(app);
		this.values = structuredClone(options.values);
	}

	override onOpen(): void {
		const { contentEl, options } = this;
		applyDirection(this.modalEl);
		this.modalEl.addClass("versobs-form");
		this.setTitle(options.title ?? pick(options.spec.title, options.spec.name));
		const description = pick(options.spec.description);
		if (options.intro) contentEl.createEl("p", { text: options.intro });
		else if (description) contentEl.createEl("p", { text: description, cls: "versobs-muted" });

		const hidden = new Set(options.hidden ?? []);
		const fields = fieldsOf(options.spec).filter((f) => !hidden.has(f.key));
		const main = fields.filter((f) => !f.advanced);
		const advanced = fields.filter((f) => f.advanced);

		for (const field of main) this.renderField(contentEl, field);
		if (advanced.length) {
			const details = contentEl.createEl("details", { cls: "versobs-advanced" });
			details.createEl("summary", { text: t("form.advanced") });
			for (const field of advanced) this.renderField(details, field);
		}

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText(options.submitText ?? t("form.run"))
					.setCta()
					.onClick(() => this.submit()),
			)
			.addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()));
	}

	private submit(): void {
		for (const flush of this.pending) flush();
		const values = coerce(this.options.spec, this.values);
		const missing = missingRequired(this.options.spec, values);
		if (missing.length) {
			const labels = missing.map((key) => pick(this.options.spec.params.properties?.[key]?.["x-label"], key));
			new Notice(t("form.missing", { fields: joinList(labels) }));
			return;
		}
		this.submitted = true;
		this.resolve(values);
		this.close();
	}

	override onClose(): void {
		this.contentEl.empty();
		this.pending = [];
		if (!this.submitted) this.resolve(null);
	}

	private renderField(container: HTMLElement, field: Field): void {
		const prop = field.schema;
		const setting = new Setting(container).setName(pick(prop["x-label"], field.key) + (field.required ? " *" : ""));
		const help = pick(prop["x-help"]);
		if (help) setting.setDesc(help);
		const widget = prop["x-widget"];
		const current = this.values[field.key];
		const set = (value: unknown) => (this.values[field.key] = value);

		if (prop.type === "boolean") {
			setting.addToggle((toggle) => toggle.setValue(current === true).onChange(set));
			return;
		}
		if (prop.enum && prop.type !== "array") {
			setting.addDropdown((dd) => {
				for (const option of prop.enum ?? []) dd.addOption(String(option), choiceLabel(prop, String(option)));
				dd.setValue(asText(current ?? prop.default ?? prop.enum?.[0]));
				dd.onChange(set);
				if (current === undefined) set(dd.getValue());
			});
			return;
		}
		if (prop.type === "array") {
			const itemEnum = prop.items?.enum;
			if (itemEnum) {
				this.renderMultiChoice(setting, prop, itemEnum.map(String), field.key);
				return;
			}
			if (widget === "files" || widget === "folder") {
				this.renderPathList(setting, prop, field.key, widget === "folder" ? "folder" : "file");
				return;
			}
			setting.addText((text) =>
				text
					.setPlaceholder(t("form.commaSeparated"))
					.setValue(Array.isArray(current) ? current.join(", ") : "")
					.onChange(set),
			);
			return;
		}
		if (prop.type === "object") {
			setting.addTextArea((area) =>
				area.setValue(current ? JSON.stringify(current, null, 2) : "").onChange((v) => {
					try {
						set(v.trim() ? JSON.parse(v) : undefined);
					} catch {
						/* keep typing */
					}
				}),
			);
			return;
		}
		if (widget === "textarea") {
			setting.setClass("versobs-textarea-setting");
			setting.addTextArea((area) => {
				area.setValue(asText(current)).onChange(set);
				area.inputEl.rows = 4;
			});
			return;
		}

		setting.addText((text) => {
			text.setValue(asText(current)).onChange(set);
			text.inputEl.addClass("versobs-wide-input");
			if (widget === "secret") text.inputEl.type = "password";
			if (prop.type === "integer" || prop.type === "number") text.inputEl.type = "number";
			if (widget === "date") text.setPlaceholder("1404-07-01");
			if (widget === "file") new PathSuggest(this.app, text.inputEl, "file", prop["x-accept"]);
			if (widget === "folder" || widget === "output-folder") new PathSuggest(this.app, text.inputEl, "folder");
			if (widget === "output-file") new PathSuggest(this.app, text.inputEl, "file");
			if (prop.default !== undefined && prop.default !== null && current === undefined) {
				text.setPlaceholder(asText(prop.default));
			}
		});
	}

	private renderMultiChoice(setting: Setting, prop: ParamSchema, options: string[], key: string): void {
		const selected = new Set(Array.isArray(this.values[key]) ? (this.values[key] as string[]) : []);
		const box = setting.controlEl.createDiv({ cls: "versobs-chips" });
		for (const option of options) {
			const label = box.createEl("label", { cls: "versobs-chip" });
			const input = label.createEl("input", { type: "checkbox" });
			input.checked = selected.has(option);
			label.appendText(" " + choiceLabel(prop.items ?? {}, option, prop));
			input.addEventListener("change", () => {
				if (input.checked) selected.add(option);
				else selected.delete(option);
				this.values[key] = options.filter((o) => selected.has(o));
			});
		}
	}

	private renderPathList(setting: Setting, prop: ParamSchema, key: string, kind: "file" | "folder"): void {
		const items: string[] = Array.isArray(this.values[key]) ? [...(this.values[key] as string[])] : [];
		const listEl = setting.controlEl.createDiv({ cls: "versobs-path-list" });
		const render = () => {
			listEl.empty();
			for (const [index, item] of items.entries()) {
				const row = listEl.createDiv({ cls: "versobs-path-item" });
				row.createSpan({ text: item || "/" });
				const remove = row.createEl("button", { text: "×", attr: { "aria-label": t("common.remove") } });
				remove.addEventListener("click", () => {
					items.splice(index, 1);
					this.values[key] = [...items];
					render();
				});
			}
		};
		render();
		const add = (path: string) => {
			if (!items.includes(path)) items.push(path);
			this.values[key] = [...items];
			render();
		};
		setting.addText((text) => {
			text.setPlaceholder(t(kind === "folder" ? "form.addFolder" : "form.addFile"));
			new PathSuggest(this.app, text.inputEl, kind, prop["x-accept"], add);
			const commit = (): boolean => {
				const value = text.getValue().trim();
				if (!value) return false;
				add(value);
				text.setValue("");
				return true;
			};
			// Text left in the box when Run is pressed counts too.
			this.pending.push(commit);
			text.inputEl.addEventListener("keydown", (evt) => {
				// Links or absolute paths can be typed and added with Enter.
				if (evt.key === "Enter" && commit()) evt.preventDefault();
			});
		});
	}
}

function choiceLabel(prop: ParamSchema, value: string, parent?: ParamSchema): string {
	const labels = prop["x-choices"] ?? parent?.["x-choices"];
	return labels?.[value] ? pick(labels[value], value) : value;
}

export function openForm(app: App, options: FormOptions): Promise<Record<string, unknown> | null> {
	return new Promise((resolve) => new SchemaFormModal(app, options, resolve).open());
}
