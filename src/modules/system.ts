// Versline and plugin housekeeping: updates, a Bases view of generated notes, settings shortcut.
import { Notice } from "obsidian";
import type { ModuleContext, VersobsModule } from "../core/module";
import { VaultPaths } from "../core/paths";
import { t } from "../i18n";

/** A Bases file listing every note Versobs generated (they carry versline_* properties). */
export function outputsBase(): string {
	return [
		"filters:",
		"  and:",
		'    - file.hasProperty("versline_tool")',
		"views:",
		"  - type: table",
		`    name: ${JSON.stringify(t("base.viewName"))}`,
		"    order:",
		"      - file.name",
		"      - versline_tool",
		"      - versline_source",
		"      - versline_model",
		"      - versline_cost_usd",
		"      - created",
		"",
	].join("\n");
}

async function createBase(ctx: ModuleContext): Promise<void> {
	const app = ctx.app;
	const folder = ctx.core.settings.outputPlacement === "folder" ? ctx.core.settings.outputFolder.trim() : "";
	await ctx.core.paths.ensureFolder(folder);
	const path = VaultPaths.join(folder, `${t("base.fileName")}.base`);
	let file = app.vault.getFileByPath(path);
	if (!file) file = await app.vault.create(path, outputsBase());
	else new Notice(t("base.exists"));
	await app.workspace.getLeaf("tab").openFile(file);
}

export const systemModule: VersobsModule = {
	id: "system",
	name: "module.system",
	description: "module.system.desc",
	tools: ["obsidian.status", "obsidian.install", "system.check_update"],
	load(ctx) {
		const plugin = ctx.core.plugin;
		ctx.addCommand({ id: "update-plugin", name: t("cmd.updatePlugin"), icon: "download", callback: () => void plugin.checkPluginUpdate(true) });
		ctx.addCommand({ id: "update-versline", name: t("cmd.updateVersline"), icon: "download", callback: () => void plugin.checkVerslineUpdate(true) });
		ctx.addCommand({ id: "outputs-base", name: t("cmd.outputsBase"), icon: "table", callback: () => void createBase(ctx) });
		ctx.addCommand({ id: "settings", name: t("cmd.settings"), icon: "settings", callback: () => plugin.openSettings() });
	},
};
