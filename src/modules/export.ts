// Export notes or folders to Word and PDF (Persian/RTL aware).
import { type TAbstractFile, TFile, TFolder } from "obsidian";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import { activeFileCommand, addFilesMenuItem, addMenuItem, isMarkdown, notifyOutputs } from "./_shared";

async function exportItem(ctx: ModuleContext, item: TAbstractFile): Promise<void> {
	const core = ctx.core;
	const folder = ctx.get<string>("folder")?.trim();
	const result = await core.runTool({
		tool: "export",
		title: t("export.title", { name: item.name || core.app.vault.getName() }),
		values: { inputs: [item.path === "/" ? "" : item.path], recursive: item instanceof TFolder, ...(folder ? { output: folder } : {}) },
		hidden: ["inputs"],
	});
	if (result?.outcome.status !== "success") return;
	notifyOutputs(core, result, t("export.done"));
	const pdf = result.outcome.artifacts.find((a) => a.exists && /\.pdf$/i.test(a.path));
	const vaultPdf = pdf ? core.paths.toVault(pdf.path) : null;
	if (core.settings.openResults && vaultPdf && item instanceof TFile) {
		await core.app.workspace.openLinkText(vaultPdf, "", true);
	}
}

async function exportMany(ctx: ModuleContext, inputs: string[]): Promise<void> {
	const core = ctx.core;
	const folder = ctx.get<string>("folder")?.trim();
	await core.runEach({
		tool: "export",
		inputs,
		formTitle: t("export.cmdBatch"),
		values: folder ? { output: folder } : {},
		title: (input) => t("export.title", { name: core.inputName(input) }),
		perInput: () => ({ recursive: false }),
		after: (result, _input, single) => {
			if (single || result.outcome.status === "success") notifyOutputs(core, result, t("export.done"));
		},
	});
}

export const exportModule: VersobsModule = {
	id: "export",
	name: "module.export",
	description: "module.export.desc",
	tools: ["export"],
	defaults: { folder: "" },
	settings: (ctx) => [
		{
			name: t("export.folder"),
			desc: t("export.folderDesc"),
			control: { type: "folder", key: ctx.key("folder"), defaultValue: "" },
		},
		{
			name: t("export.installBrowser"),
			desc: t("export.installBrowserDesc"),
			action: () =>
				void ctx.core.runTool({ tool: "export.install_browser", skipForm: true, remember: false, title: t("export.installBrowser") }),
		},
	],
	load(ctx) {
		ctx.onFileMenu((menu, file) => {
			if (isMarkdown(file) || file instanceof TFolder) {
				addMenuItem(menu, t("export.menu"), "file-output", () => void exportItem(ctx, file));
			}
		});
		ctx.onFilesMenu((menu, files) =>
			addFilesMenuItem(menu, files, isMarkdown, (count) => t("export.menuMany", { count }), "file-output", (list) =>
				void exportMany(ctx, list.map((f) => f.path)),
			),
		);
		ctx.addCommand({
			id: "batch",
			name: t("export.cmdBatch"),
			icon: "file-output",
			callback: () => void exportMany(ctx, []),
		});
		ctx.addCommand({
			id: "active-file",
			name: t("export.cmdFile"),
			icon: "file-output",
			checkCallback: activeFileCommand(ctx.core, isMarkdown, (file) => void exportItem(ctx, file)),
		});
	},
};
