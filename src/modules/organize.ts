// Read-only folder reports: sizes, file kinds and duplicates, saved as notes.
import { TFolder } from "obsidian";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import { addMenuItem, notifyOutputs, outputName } from "./_shared";

async function report(ctx: ModuleContext, folder: TFolder): Promise<void> {
	const core = ctx.core;
	const name = folder.isRoot() ? core.app.vault.getName() : folder.name;
	const result = await core.runTool({
		tool: "organize.report",
		title: t("organize.title", { name }),
		values: {
			sources: [folder.isRoot() ? "" : folder.path],
			copy_to: core.outputPath(folder.isRoot() ? null : folder, outputName("tpl.reports", { stem: name })),
		},
		hidden: ["sources"],
	});
	notifyOutputs(core, result, t("organize.done"));
	await core.finish(result, { stamp: false });
}

export const organizeModule: VersobsModule = {
	id: "organize",
	name: "module.organize",
	description: "module.organize.desc",
	tools: ["organize.report"],
	load(ctx) {
		ctx.onFileMenu((menu, file) => {
			if (file instanceof TFolder) addMenuItem(menu, t("organize.menu"), "copy", () => void report(ctx, file));
		});
		ctx.addCommand({
			id: "vault",
			name: t("organize.cmdVault"),
			icon: "copy",
			callback: () => void report(ctx, ctx.app.vault.getRoot()),
		}, "general");
	},
};
