// Qualitative coding of interviews (thematic, grounded, content, framework, Colaizzi).
import { type TAbstractFile, type TFile, TFolder } from "obsidian";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import { activeFileCommand, addFilesMenuItem, addMenuItem, isNote, notifyOutputs, outputName } from "./_shared";

async function code(ctx: ModuleContext, item: TAbstractFile): Promise<void> {
	const core = ctx.core;
	const stem = item instanceof TFolder ? item.name || core.app.vault.getName() : item.name.replace(/\.[^.]+$/, "");
	const result = await core.runTool({
		tool: "qualcode",
		title: t("qualcode.title", { name: item.name || core.app.vault.getName() }),
		values: {
			inputs: [item.path === "/" ? "" : item.path],
			output_dir: core.outputPath(item, outputName("tpl.coding", { stem })),
		},
		hidden: ["inputs"],
	});
	notifyOutputs(core, result, t("qualcode.done"));
	await core.finish(result, { source: item });
}

/** Several interviews go into one job: the analysis codes them together. */
async function codeMany(ctx: ModuleContext, files: TFile[]): Promise<void> {
	const core = ctx.core;
	const first = files[0];
	if (!first) return;
	const result = await core.runTool({
		tool: "qualcode",
		title: t("qualcode.title", { name: `${first.name} +${files.length - 1}` }),
		values: {
			inputs: files.map((f) => f.path),
			output_dir: core.outputPath(first, outputName("tpl.coding", { stem: first.basename })),
		},
	});
	notifyOutputs(core, result, t("qualcode.done"));
	await core.finish(result, { source: first });
}

export const qualcodeModule: VersobsModule = {
	id: "qualcode",
	name: "module.qualcode",
	description: "module.qualcode.desc",
	tools: ["qualcode"],
	load(ctx) {
		ctx.onFileMenu((menu, file) => {
			if (isNote(file) || file instanceof TFolder) addMenuItem(menu, t("qualcode.menu"), "tags", () => void code(ctx, file));
		});
		ctx.onFilesMenu((menu, files) =>
			addFilesMenuItem(menu, files, isNote, (count) => t("qualcode.menuMany", { count }), "tags", (list) =>
				void codeMany(ctx, list),
			),
		);
		ctx.addCommand({
			id: "active-file",
			name: t("qualcode.cmdFile"),
			icon: "tags",
			checkCallback: activeFileCommand(ctx.core, isNote, (file) => void code(ctx, file)),
		}, "file");
	},
};
