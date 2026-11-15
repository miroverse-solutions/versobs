// Staged research writing: draft an outline note, review/edit it in Obsidian, then write the full chapter from it.
// The study settings travel with the outline note (front matter `versobs_research`), so step 2 can be run later.
import { ConfirmationModal, Notice, type TFile } from "obsidian";
import { timestamp } from "../core/paths";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import { isMarkdown, outputName } from "./_shared";

const PROPERTY = "versobs_research";

interface ResearchProperty {
	stage: "outline" | "full";
	params?: Record<string, unknown>;
	outline?: string;
}

function researchProperty(ctx: ModuleContext, file: TFile | null): ResearchProperty | null {
	if (!file) return null;
	const value = ctx.app.metadataCache.getFileCache(file)?.frontmatter?.[PROPERTY] as ResearchProperty | undefined;
	return value && typeof value === "object" ? value : null;
}

async function newOutline(ctx: ModuleContext): Promise<void> {
	const core = ctx.core;
	const active = core.app.workspace.getActiveFile();
	const result = await core.runTool({
		tool: "research.outline",
		title: t("research.outlineTitle"),
		values: { output: core.outputPath(active, `${t("tpl.outline")} ${timestamp(new Date(), false)}.md`) },
		intro: t("research.outlineIntro"),
	});
	const [note] = await core.finish(result, {});
	if (!note || !result) return;
	const params: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(result.values)) {
		if (key === "output" || value === undefined || value === null || value === "") continue;
		params[key] = value;
	}
	await core.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
		fm[PROPERTY] = { stage: "outline", params };
	});
	new Notice(t("research.outlineReady"), 10000);
}

function approveAndWrite(ctx: ModuleContext, outline: TFile): void {
	let approved = false;
	new ConfirmationModal(ctx.app)
		.setTitle(t("research.approveTitle"))
		.setContent(t("research.approveBody", { name: outline.basename }))
		.addCheckbox(t("research.approveCheck"), (value: boolean) => (approved = value))
		.addButton((b) =>
			b
				.setButtonText(t("research.writeFull"))
				.setCta()
				.onClick(() => {
					if (!approved) {
						new Notice(t("research.approveFirst"));
						return true; // keep the modal open
					}
					void writeFull(ctx, outline);
					return false;
				}),
		)
		.addCancelButton(t("common.cancel"))
		.open();
}

async function writeFull(ctx: ModuleContext, outline: TFile): Promise<void> {
	const core = ctx.core;
	const stored = researchProperty(ctx, outline)?.params ?? {};
	const values: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(stored)) values[key] = value;
	values.approved_outline_file = outline.path;
	values.approve_outline = true;
	values.output = core.outputPath(outline, outputName("tpl.fullText", { stem: outline.basename }) + ".md");
	const result = await core.runTool({
		tool: "research.full",
		title: t("research.fullTitle", { name: outline.basename }),
		values,
		hidden: ["approved_outline_file", "approve_outline"],
		remember: false,
		transform: (v) => ({ ...v, approve_outline: true }),
	});
	const [note] = await core.finish(result, { source: outline });
	if (note) {
		await core.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
			fm[PROPERTY] = { stage: "full", outline: `[[${core.app.metadataCache.fileToLinktext(outline, note.path, false)}]]` };
		});
	}
}

export const researchModule: VersobsModule = {
	id: "research",
	name: "module.research",
	description: "module.research.desc",
	tools: ["research.outline", "research.full"],
	load(ctx) {
		ctx.addCommand({ id: "outline", name: t("research.cmdOutline"), icon: "graduation-cap", callback: () => void newOutline(ctx) });
		ctx.addCommand({
			id: "full",
			name: t("research.cmdFull"),
			icon: "graduation-cap",
			checkCallback: (checking) => {
				// Any note can serve as the outline; notes made by step 1 also carry the study settings.
				const file = ctx.app.workspace.getActiveFile();
				if (!isMarkdown(file) || researchProperty(ctx, file)?.stage === "full") return false;
				if (!checking) approveAndWrite(ctx, file);
				return true;
			},
		});
	},
};
