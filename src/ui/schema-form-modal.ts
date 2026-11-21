// A form generated from a tool's parameter schema (bilingual labels and widget hints come from Versline).
// This is what lets any new Versline tool be used from Obsidian without plugin changes.
import { type App, Modal, Notice, setIcon, Setting, type TextComponent } from "obsidian";
import type { ParamSchema, ToolSpec } from "../bridge/protocol";
import { asText, coerce, type Field, fieldsOf, joinOutput, missingRequired, splitOutput } from "../bridge/schema";
import { applyDirection, joinList, pick, t } from "../i18n";
import { VaultPaths } from "../core/paths";
import { PathSuggest } from "./file-suggest";
import { FolderPickerModal } from "./folder-picker";
import { pickPaths } from "./native-picker";
import { renderPath } from "./path-view";

export interface FormOptions {
	spec: ToolSpec;
	values: Record<string, unknown>;
	/** Fields filled by the caller and not shown. */
	hidden?: string[];
	title?: string;
	submitText?: string;
	/** Extra text above the fields. */
	intro?: string;
	/** Batch forms: add one output-folder control for all items (the result's OUTPUT_FOLDER_KEY, when chosen). */
	outputFolder?: boolean;
}

/** Key under which a batch form returns the chosen output folder (absent = use the settings' default placement). */
export const OUTPUT_FOLDER_KEY = "__outputFolder";

export class SchemaFormModal extends Modal {
	private values: Record<string, unknown>;
	private submitted = false;
	/** Batch output folder: null = default placement from settings. */
	private folder: string | null = null;
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

		if (options.outputFolder) this.renderBatchFolder(contentEl);

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
		if (this.folder !== null) values[OUTPUT_FOLDER_KEY] = this.folder;
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
		if (widget === "output-file" || widget === "output-folder") {
			this.renderOutputField(setting, prop, current, widget === "output-folder" ? "folder" : "file", set);
			return;
		}

		let textInput: TextComponent | null = null;
		setting.addText((text) => {
			textInput = text;
			text.setValue(asText(current)).onChange(set);
			text.inputEl.addClass("versobs-wide-input");
			if (widget === "secret") text.inputEl.type = "password";
			if (prop.type === "integer" || prop.type === "number") text.inputEl.type = "number";
			if (widget === "date") text.setPlaceholder("1404-07-01");
			if (widget === "file" || widget === "folder") text.inputEl.dir = "auto";
			if (widget === "file") new PathSuggest(this.app, text.inputEl, "file", prop["x-accept"]);
			if (widget === "folder") new PathSuggest(this.app, text.inputEl, "folder");
			if (prop.default !== undefined && prop.default !== null && current === undefined) {
				text.setPlaceholder(asText(prop.default));
			}
		});
		const browseKind = widget === "file" ? "file" : widget === "folder" ? "folder" : null;
		if (browseKind && textInput) {
			const input: TextComponent = textInput;
			this.addBrowse(setting, browseKind, false, prop["x-accept"], (paths) => {
				const value = paths[0];
				if (value === undefined) return;
				input.setValue(value);
				set(value);
			});
		}
	}

	/** One output folder for every file of a batch; "default" follows the settings (next to the source, or the output folder). */
	private renderBatchFolder(container: HTMLElement): void {
		const setting = new Setting(container).setName(t("form.batchFolder")).setDesc(t("form.batchFolderDesc"));
		const folderBtn = setting.controlEl.createEl("button", { cls: "versobs-folder-btn" });
		setIcon(folderBtn.createSpan(), "folder");
		const label = folderBtn.createSpan();
		const show = () => {
			if (this.folder === null) {
				label.empty();
				label.removeClass("versobs-path");
				label.setText(t("form.defaultFolder"));
				label.title = t("form.defaultFolder");
			} else renderPath(label, this.folder, "›", this.app.vault.getName());
		};
		show();
		const choose = (folder: string | null) => {
			this.folder = folder;
			show();
		};
		folderBtn.addEventListener("click", () => new FolderPickerModal(this.app, this.folder ?? "", choose).open());
		this.addBrowse(setting, "folder", false, undefined, (paths) => {
			if (paths[0] !== undefined) choose(paths[0]);
		});
		setting.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip(t("form.defaultFolder"))
				.onClick(() => choose(null)),
		);
	}

	/**
	 * Output file/folder: pick the folder from a list (or the system dialog) and edit just the name,
	 * so Persian paths never have to be typed or read as one scrambled line. The value stays one string.
	 */
	private renderOutputField(
		setting: Setting,
		prop: ParamSchema,
		current: unknown,
		kind: "file" | "folder",
		set: (value: unknown) => void,
	): void {
		const fallback = splitOutput(asText(prop.default), kind);
		const parts = splitOutput(asText(current), kind);
		if (kind === "file" && !parts.ext) parts.ext = fallback.ext;
		const update = () => set(joinOutput(parts));

		const box = setting.controlEl.createDiv({ cls: "versobs-output" });
		const folderRow = box.createDiv({ cls: "versobs-output-row" });
		const folderBtn = folderRow.createEl("button", {
			cls: "versobs-folder-btn",
			attr: { "aria-label": t("form.outputFolder") },
		});
		setIcon(folderBtn.createSpan(), "folder");
		const label = folderBtn.createSpan();
		const showFolder = () => renderPath(label, parts.folder, "›", this.app.vault.getName());
		showFolder();
		const setFolder = (folder: string) => {
			parts.folder = folder;
			showFolder();
			update();
		};
		folderBtn.addEventListener("click", () => new FolderPickerModal(this.app, parts.folder, setFolder).open());
		this.addBrowse(setting, "folder", false, undefined, (paths) => {
			if (paths[0] !== undefined) setFolder(paths[0]);
		});

		const nameRow = box.createDiv({ cls: "versobs-output-row" });
		const input = nameRow.createEl("input", {
			type: "text",
			cls: "versobs-output-name",
			attr: { "aria-label": t("form.outputName"), placeholder: fallback.name || t("form.outputName"), dir: "auto" },
		});
		input.value = parts.name;
		input.addEventListener("input", () => {
			parts.name = input.value;
			update();
		});
		if (parts.ext) nameRow.createSpan({ text: parts.ext, cls: "versobs-output-ext" });
	}

	/** A "Browse…" button that opens the system file/folder dialog; vault paths are shortened to vault-relative. */
	private addBrowse(
		setting: Setting,
		kind: "file" | "folder",
		multiple: boolean,
		accept: string[] | undefined,
		onPick: (paths: string[]) => void,
	): void {
		setting.addExtraButton((button) =>
			button
				.setIcon("folder-open")
				.setTooltip(t("form.browse"))
				.onClick(async () => {
					const paths = new VaultPaths(this.app);
					let base: string | undefined;
					try {
						base = paths.base();
					} catch {
						base = undefined;
					}
					const picked = await pickPaths({ kind, multiple, accept, defaultPath: base, title: t("form.browse") });
					if (!picked.length) return;
					onPick(picked.map((abs) => (base ? (paths.toVault(abs) ?? abs) : abs)));
				}),
		);
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
				renderPath(row.createSpan(), item);
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
		this.addBrowse(setting, kind, true, prop["x-accept"], (paths) => paths.forEach(add));
		setting.addText((text) => {
			text.setPlaceholder(t(kind === "folder" ? "form.addFolder" : "form.addFile"));
			text.inputEl.dir = "auto";
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
