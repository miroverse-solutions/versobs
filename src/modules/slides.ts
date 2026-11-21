// Turn a note into an HTML slide deck and open it in the browser.
import type { TFile } from "obsidian";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import { activeFileCommand, addFilesMenuItem, addMenuItem, isMarkdown, notifyOutputs, outputName } from "./_shared";

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

async function makeSlidesMany(ctx: ModuleContext, inputs: string[]): Promise<void> {
	const core = ctx.core;
	await core.runEach({
		tool: "slides",
		inputs,
		formTitle: t("slides.cmdBatch"),
		hidden: ["output_dir"],
		title: (input) => t("slides.title", { name: core.inputName(input) }),
		perInput: (input, _values, _index, folder) => ({
			output_dir: core.outputFor(input, (stem) => outputName("tpl.slides", { stem: stem ?? "" }), folder),
		}),
		after: async (result, _input, single) => {
			if (result.outcome.status !== "success") return;
			const decks = (result.outcome.data.decks as string[] | undefined) ?? [];
			if (single && decks[0] && core.settings.openResults) await core.openExternal(decks[0]);
			else notifyOutputs(core, result, t("slides.done"));
		},
	});
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
		ctx.onFilesMenu((menu, files) =>
			addFilesMenuItem(menu, files, isMarkdown, (count) => t("slides.menuMany", { count }), "presentation", (list) =>
				void makeSlidesMany(ctx, list.map((f) => f.path)),
			),
		);
		ctx.addCommand({
			id: "batch",
			name: t("slides.cmdBatch"),
			icon: "presentation",
			callback: () => void makeSlidesMany(ctx, []),
		}, "general");
		ctx.addCommand({
			id: "active-file",
			name: t("slides.cmdFile"),
			icon: "presentation",
			checkCallback: activeFileCommand(ctx.core, isMarkdown, (file) => void makeSlides(ctx, file)),
		}, "file");
	},
};
