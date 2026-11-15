// Turn a note into an HTML slide deck and open it in the browser.
import type { TFile } from "obsidian";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import { activeFileCommand, addMenuItem, isMarkdown, notifyOutputs, outputName } from "./_shared";

async function makeSlides(ctx: ModuleContext, file: TFile): Promise<void> {
	const core = ctx.core;
	const result = await core.runTool({
		tool: "slides",
		title: t("slides.title", { name: file.name }),
		values: { inputs: [file.path], output_dir: core.outputPath(file, outputName("tpl.slides", { stem: file.basename })) },
		hidden: ["inputs"],
	});
	if (result?.outcome.status !== "success") return;
	const decks = (result.outcome.data.decks as string[] | undefined) ?? [];
	if (decks[0] && core.settings.openResults) await core.openExternal(decks[0]);
	else notifyOutputs(core, result, t("slides.done"));
}

export const slidesModule: VersobsModule = {
	id: "slides",
	name: "module.slides",
	description: "module.slides.desc",
	tools: ["slides"],
	load(ctx) {
		ctx.onFileMenu((menu, file) => {
			if (isMarkdown(file)) addMenuItem(menu, t("slides.menu"), "presentation", () => void makeSlides(ctx, file));
		});
		ctx.addCommand({
			id: "active-file",
			name: t("slides.cmdFile"),
			icon: "presentation",
			checkCallback: activeFileCommand(ctx.core, isMarkdown, (file) => void makeSlides(ctx, file)),
		});
	},
};
