// Transcribe audio/video files in the vault (or links) into notes.
import type { TFile } from "obsidian";
import { timestamp } from "../core/paths";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import { activeFileCommand, addFilesMenuItem, addMenuItem, afterFrontmatter, isMedia, outputName } from "./_shared";

async function transcribe(ctx: ModuleContext, file: TFile): Promise<void> {
	const core = ctx.core;
	const output = core.outputPath(file, outputName("tpl.transcript", { stem: file.basename }) + ".md");
	const result = await core.runTool({
		tool: "transcribe",
		title: t("transcribe.title", { name: file.name }),
		values: { inputs: [file.path], output, timestamped: ctx.get<boolean>("timestamped") },
		hidden: ["inputs"],
	});
	const notes = await core.finish(result, { source: file });
	await embedMedia(ctx, file, notes);
}

/** Put ![[media]] at the top of the transcript note when the setting is on. */
async function embedMedia(ctx: ModuleContext, file: TFile, notes: TFile[]): Promise<void> {
	if (!notes.length || !ctx.get<boolean>("embed")) return;
	const note = notes.find((n) => n.extension === "md");
	if (!note) return;
	const link = ctx.app.metadataCache.fileToLinktext(file, note.path, false);
	await ctx.app.vault.process(note, (data) =>
		data.includes(`![[${link}]]`) ? data : afterFrontmatter(data, `![[${link}]]\n\n`),
	);
}

/** Several files and/or links: one form, one job per item. Opened with no items it starts with an empty list. */
async function transcribeMany(ctx: ModuleContext, inputs: string[]): Promise<void> {
	const core = ctx.core;
	const stamp = timestamp();
	await core.runEach({
		tool: "transcribe",
		inputs,
		formTitle: t("transcribe.titleUrl"),
		intro: t("transcribe.urlIntro"),
		hidden: ["output"],
		values: { timestamped: ctx.get<boolean>("timestamped") },
		title: (input) => t("transcribe.title", { name: core.inputName(input) }),
		perInput: (input, _values, index, folder) => ({
			output: core.outputFor(input, (stem) =>
				stem ? outputName("tpl.transcript", { stem }) + ".md" : `${t("tpl.transcriptUrl")} ${stamp} ${index + 1}.md`,
				folder,
			),
		}),
		after: async (result, input, single) => {
			const file = core.sourceFile(input);
			const notes = await core.finish(result, { source: file, open: single ? undefined : false });
			if (file) await embedMedia(ctx, file, notes);
		},
	});
}

export const transcribeModule: VersobsModule = {
	id: "transcribe",
	name: "module.transcribe",
	description: "module.transcribe.desc",
	tools: ["transcribe"],
	defaults: { embed: true, timestamped: false },
	settings: (ctx) => [
		{
			name: t("transcribe.embed"),
			desc: t("transcribe.embedDesc"),
			control: { type: "toggle", key: ctx.key("embed"), defaultValue: true },
		},
		{
			name: t("transcribe.timestamped"),
			desc: t("transcribe.timestampedDesc"),
			control: { type: "toggle", key: ctx.key("timestamped"), defaultValue: false },
		},
	],
	load(ctx) {
		ctx.onFileMenu((menu, file) => {
			if (isMedia(file)) addMenuItem(menu, t("transcribe.menu"), "mic", () => void transcribe(ctx, file));
		});
		ctx.onFilesMenu((menu, files) =>
			addFilesMenuItem(menu, files, isMedia, (count) => t("transcribe.menuMany", { count }), "mic", (list) =>
				void transcribeMany(ctx, list.map((f) => f.path)),
			),
		);
		ctx.addCommand({
			id: "active-file",
			name: t("transcribe.cmdFile"),
			icon: "mic",
			checkCallback: activeFileCommand(ctx.core, isMedia, (file) => void transcribe(ctx, file)),
		}, "file");
		ctx.addCommand({
			id: "link",
			name: t("transcribe.cmdUrl"),
			icon: "link",
			callback: () => void transcribeMany(ctx, []),
		}, "general");
	},
};
