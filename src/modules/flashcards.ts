// Questions and flashcards (multiple choice or descriptive) exported to Anki, CSV and HTML.
import { type TAbstractFile, TFolder } from "obsidian";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import { activeFileCommand, addMenuItem, isDocument, notifyOutputs, outputName } from "./_shared";

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
		ctx.addCommand({
			id: "active-file",
			name: t("flashcards.cmdFile"),
			icon: "layers",
			checkCallback: activeFileCommand(ctx.core, isDocument, (file) => void makeQuestions(ctx, file)),
		});
	},
};
