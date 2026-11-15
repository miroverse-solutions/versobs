// Summaries of notes and documents (PDF, Word, PowerPoint, ...), or of the selected text.
import type { Editor, TFile } from "obsidian";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import {
	activeFileCommand,
	addMenuItem,
	type InsertMode,
	insertResult,
	isDocument,
	outputName,
	selectionCommandGuard,
} from "./_shared";

async function summarizeFile(ctx: ModuleContext, file: TFile): Promise<void> {
	const core = ctx.core;
	const result = await core.runTool({
		tool: "summarize.file",
		title: t("summarize.title", { name: file.name }),
		values: {
			inputs: [file.path],
			output: core.outputPath(file, outputName("tpl.summary", { stem: file.basename }) + ".md"),
		},
		hidden: ["inputs"],
	});
	await core.finish(result, { source: file });
}

async function summarizeSelection(ctx: ModuleContext, editor: Editor): Promise<void> {
	const text = selectionCommandGuard(editor);
	if (!text) return;
	const result = await ctx.core.runTool({
		tool: "summarize.text",
		title: t("summarize.selectionTitle"),
		values: { text },
		hidden: ["text"],
	});
	const summary = result?.outcome.status === "success" ? (result.outcome.data.text as string | undefined) : undefined;
	if (summary) insertResult(editor, summary, ctx.get<InsertMode>("insert"), t("summarize.calloutTitle"), "summary");
}

export const summarizeModule: VersobsModule = {
	id: "summarize",
	name: "module.summarize",
	description: "module.summarize.desc",
	tools: ["summarize.file", "summarize.text"],
	defaults: { insert: "callout" },
	settings: (ctx) => [
		{
			name: t("settings.insertMode"),
			desc: t("settings.insertModeDesc"),
			control: {
				type: "dropdown",
				key: ctx.key("insert"),
				defaultValue: "callout",
				options: { callout: t("insert.callout"), below: t("insert.below"), replace: t("insert.replace") },
			},
		},
	],
	load(ctx) {
		ctx.onFileMenu((menu, file) => {
			if (isDocument(file)) addMenuItem(menu, t("summarize.menu"), "list-collapse", () => void summarizeFile(ctx, file));
		});
		ctx.onEditorMenu((menu, editor) => {
			if (editor.getSelection().trim()) {
				addMenuItem(menu, t("summarize.menuSelection"), "list-collapse", () => void summarizeSelection(ctx, editor));
			}
		});
		ctx.addCommand({
			id: "active-file",
			name: t("summarize.cmdFile"),
			icon: "list-collapse",
			checkCallback: activeFileCommand(ctx.core, isDocument, (file) => void summarizeFile(ctx, file)),
		});
		ctx.addCommand({
			id: "selection",
			name: t("summarize.cmdSelection"),
			icon: "list-collapse",
			editorCallback: (editor) => void summarizeSelection(ctx, editor),
		});
	},
};
