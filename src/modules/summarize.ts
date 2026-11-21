// Summaries of notes and documents (PDF, Word, PowerPoint, ...), or of the selected text.
import type { Editor, TFile } from "obsidian";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import {
	activeFileCommand,
	addFilesMenuItem,
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

async function summarizeMany(ctx: ModuleContext, inputs: string[]): Promise<void> {
	const core = ctx.core;
	await core.runEach({
		tool: "summarize.file",
		inputs,
		formTitle: t("summarize.cmdBatch"),
		hidden: ["output"],
		title: (input) => t("summarize.title", { name: core.inputName(input) }),
		perInput: (input) => ({
			output: core.outputFor(input, (stem) => outputName("tpl.summary", { stem: stem ?? "" }) + ".md"),
		}),
		after: async (result, input, single) => {
			await core.finish(result, { source: core.sourceFile(input), open: single ? undefined : false });
		},
	});
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
		ctx.onFilesMenu((menu, files) =>
			addFilesMenuItem(menu, files, isDocument, (count) => t("summarize.menuMany", { count }), "list-collapse", (list) =>
				void summarizeMany(ctx, list.map((f) => f.path)),
			),
		);
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
			id: "batch",
			name: t("summarize.cmdBatch"),
			icon: "list-collapse",
			callback: () => void summarizeMany(ctx, []),
		});
		ctx.addCommand({
			id: "selection",
			name: t("summarize.cmdSelection"),
			icon: "list-collapse",
			editorCallback: (editor) => void summarizeSelection(ctx, editor),
		});
	},
};
