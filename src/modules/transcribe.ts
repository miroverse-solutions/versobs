// Transcribe audio/video files in the vault (or links) into notes.
import type { TFile } from "obsidian";
import { timestamp } from "../core/paths";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import { activeFileCommand, addMenuItem, afterFrontmatter, isMedia, outputName } from "./_shared";

async function transcribe(ctx: ModuleContext, file: TFile | null): Promise<void> {
	const core = ctx.core;
	const output = file
		? core.outputPath(file, outputName("tpl.transcript", { stem: file.basename }) + ".md")
		: core.outputPath(core.app.workspace.getActiveFile(), `${t("tpl.transcriptUrl")} ${timestamp()}.md`);
	const result = await core.runTool({
		tool: "transcribe",
		title: file ? t("transcribe.title", { name: file.name }) : t("transcribe.titleUrl"),
		values: { inputs: file ? [file.path] : [], output, timestamped: ctx.get<boolean>("timestamped") },
		hidden: file ? ["inputs"] : [],
		intro: file ? undefined : t("transcribe.urlIntro"),
	});
	const notes = await core.finish(result, { source: file });
	if (file && notes.length && ctx.get<boolean>("embed")) {
		const note = notes.find((n) => n.extension === "md");
		if (!note) return;
		const link = core.app.metadataCache.fileToLinktext(file, note.path, false);
		await core.app.vault.process(note, (data) =>
			data.includes(`![[${link}]]`) ? data : afterFrontmatter(data, `![[${link}]]\n\n`),
		);
	}
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
		ctx.addCommand({
			id: "active-file",
			name: t("transcribe.cmdFile"),
			icon: "mic",
			checkCallback: activeFileCommand(ctx.core, isMedia, (file) => void transcribe(ctx, file)),
		});
		ctx.addCommand({
			id: "link",
			name: t("transcribe.cmdUrl"),
			icon: "link",
			callback: () => void transcribe(ctx, null),
		});
	},
};
