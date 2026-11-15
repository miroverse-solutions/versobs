// Translate notes, or the selected text in place.
import type { Editor, TFile } from "obsidian";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import {
	activeFileCommand,
	addMenuItem,
	type InsertMode,
	insertResult,
	isNote,
	outputName,
	selectionCommandGuard,
} from "./_shared";

async function translateFile(ctx: ModuleContext, file: TFile): Promise<void> {
	const core = ctx.core;
	const result = await core.runTool({
		tool: "translate.file",
		title: t("translate.title", { name: file.name }),
		values: {
			inputs: [file.path],
			output: core.outputPath(file, outputName("tpl.translation", { stem: file.basename }) + ".md"),
		},
		hidden: ["inputs"],
	});
	const notes = await core.finish(result, { source: file });
	// Versline also writes a plain-text copy (.txt) next to the note; keep the vault tidy unless asked not to.
	if (!ctx.get<boolean>("keepTxt") && result?.job.startedAt) {
		for (const note of notes) {
			const txt = core.app.vault.getFileByPath(note.path.replace(/\.md$/i, ".txt"));
			if (txt && txt.stat.mtime >= result.job.startedAt - 1000) await core.app.fileManager.trashFile(txt);
		}
	}
}

async function translateSelection(ctx: ModuleContext, editor: Editor): Promise<void> {
	const text = selectionCommandGuard(editor);
	if (!text) return;
	const result = await ctx.core.runTool({
		tool: "translate.text",
		title: t("translate.selectionTitle"),
		values: { text },
		hidden: ["text"],
	});
	const translated = result?.outcome.status === "success" ? (result.outcome.data.text as string | undefined) : undefined;
	if (translated) insertResult(editor, translated, ctx.get<InsertMode>("insert"), t("translate.calloutTitle"), "quote");
}

export const translateModule: VersobsModule = {
	id: "translate",
	name: "module.translate",
	description: "module.translate.desc",
	tools: ["translate.file", "translate.text"],
	defaults: { insert: "replace", keepTxt: false },
	settings: (ctx) => [
		{
			name: t("translate.keepTxt"),
			desc: t("translate.keepTxtDesc"),
			control: { type: "toggle", key: ctx.key("keepTxt"), defaultValue: false },
		},
		{
			name: t("settings.insertMode"),
			desc: t("settings.insertModeDesc"),
			control: {
				type: "dropdown",
				key: ctx.key("insert"),
				defaultValue: "replace",
				options: { replace: t("insert.replace"), below: t("insert.below"), callout: t("insert.callout") },
			},
		},
	],
	load(ctx) {
		ctx.onFileMenu((menu, file) => {
			if (isNote(file)) addMenuItem(menu, t("translate.menu"), "languages", () => void translateFile(ctx, file));
		});
		ctx.onEditorMenu((menu, editor) => {
			if (editor.getSelection().trim()) {
				addMenuItem(menu, t("translate.menuSelection"), "languages", () => void translateSelection(ctx, editor));
			}
		});
		ctx.addCommand({
			id: "active-file",
			name: t("translate.cmdFile"),
			icon: "languages",
			checkCallback: activeFileCommand(ctx.core, isNote, (file) => void translateFile(ctx, file)),
		});
		ctx.addCommand({
			id: "selection",
			name: t("translate.cmdSelection"),
			icon: "languages",
			editorCallback: (editor) => void translateSelection(ctx, editor),
		});
	},
};
