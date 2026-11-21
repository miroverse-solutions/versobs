// Questions and flashcards (multiple choice or descriptive) exported to Anki, CSV and HTML.
import { type TAbstractFile, type TFile, TFolder } from "obsidian";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import { activeFileCommand, addFilesMenuItem, addMenuItem, isDocument, notifyOutputs, outputName } from "./_shared";

async function makeQuestions(ctx: ModuleContext, item: TAbstractFile): Promise<void> {
	const core = ctx.core;
	const stem = item instanceof TFolder ? item.name || core.app.vault.getName() : item.name.replace(/\.[^.]+$/, "");
	const result = await core.runTool({
		tool: "qude",
		title: t("flashcards.title", { name: item.name || core.app.vault.getName() }),
		values: {
			inputs: [item.path === "/" ? "" : item.path],
			output_dir: core.outputPath(item, outputName("tpl.questions", { stem })),
		},
		hidden: ["inputs"],
	});
	notifyOutputs(core, result, t("flashcards.done"));
	await core.finish(result, { source: item, stamp: false });
}

/** Several files go into one job: the questions draw on all of them together. */
async function makeQuestionsFromMany(ctx: ModuleContext, files: TFile[]): Promise<void> {
	const core = ctx.core;
	const first = files[0];
	if (!first) return;
	const result = await core.runTool({
		tool: "qude",
		title: t("flashcards.title", { name: `${first.name} +${files.length - 1}` }),
		values: {
			inputs: files.map((f) => f.path),
			output_dir: core.outputPath(first, outputName("tpl.questions", { stem: first.basename })),
		},
	});
	notifyOutputs(core, result, t("flashcards.done"));
	await core.finish(result, { source: first, stamp: false });
}

export const flashcardsModule: VersobsModule = {
	id: "flashcards",
	name: "module.flashcards",
	description: "module.flashcards.desc",
	tools: ["qude"],
	load(ctx) {
		ctx.onFileMenu((menu, file) => {
			if (isDocument(file) || file instanceof TFolder) {
				addMenuItem(menu, t("flashcards.menu"), "layers", () => void makeQuestions(ctx, file));
			}
		});
		ctx.onFilesMenu((menu, files) =>
			addFilesMenuItem(menu, files, isDocument, (count) => t("flashcards.menuMany", { count }), "layers", (list) =>
				void makeQuestionsFromMany(ctx, list),
			),
		);
		ctx.addCommand({
			id: "active-file",
			name: t("flashcards.cmdFile"),
			icon: "layers",
			checkCallback: activeFileCommand(ctx.core, isDocument, (file) => void makeQuestions(ctx, file)),
		}, "file");
	},
};
