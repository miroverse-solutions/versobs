// Notes from a recorded talk: its taqrir, or the passages (a point, a quotation, a narration) the listener
// remembers but cannot locate. Versline transcribes each file once and remembers the transcript, so asking
// again about the same file only costs a short text-model call.
import { Notice, type TFile } from "obsidian";
import type { ModuleContext, VersobsModule } from "../core/module";
import { t } from "../i18n";
import { activeFileCommand, addMenuItem, isMedia, outputName } from "./_shared";
import { embedMedia, reportSkipped } from "./transcribe";

async function taqrir(ctx: ModuleContext, file: TFile): Promise<void> {
	const core = ctx.core;
	const result = await core.runTool({
		tool: "audio.taqrir",
		title: t("talk.taqrirTitle", { name: file.name }),
		values: { input: file.path, output: core.outputPath(file, outputName("tpl.talkTaqrir", { stem: file.basename }) + ".md") },
		hidden: ["input"],
	});
	const notes = await core.finish(result, { source: file });
	await embedMedia(ctx, file, notes);
	await reportSkipped(ctx, result, notes);
}

async function find(ctx: ModuleContext, file: TFile): Promise<void> {
	const core = ctx.core;
	const result = await core.runTool({
		tool: "audio.find",
		title: t("talk.findTitle", { name: file.name }),
		intro: t("talk.findIntro"),
		values: { input: file.path, query: "", output: core.outputPath(file, outputName("tpl.points", { stem: file.basename }) + ".md") },
		hidden: ["input"],
	});
	if (result?.outcome.status === "success") {
		const found = Number((result.outcome.data as { found?: number } | undefined)?.found ?? 0);
		new Notice(found ? t("talk.found", { count: found }) : t("talk.notFound"));
	}
	const notes = await core.finish(result, { source: file });
	await embedMedia(ctx, file, notes);
	await reportSkipped(ctx, result, notes);
}

export const talkModule: VersobsModule = {
	id: "talk",
	name: "module.talk",
	description: "module.talk.desc",
	tools: ["audio.taqrir", "audio.find"],
	defaults: { embed: true },
	settings: (ctx) => [
		{
			name: t("transcribe.embed"),
			desc: t("talk.embedDesc"),
			control: { type: "toggle", key: ctx.key("embed"), defaultValue: true },
		},
	],
	load(ctx) {
		ctx.onFileMenu((menu, file) => {
			if (!isMedia(file)) return;
			addMenuItem(menu, t("talk.menuFind"), "search", () => void find(ctx, file));
			addMenuItem(menu, t("talk.menuTaqrir"), "scroll-text", () => void taqrir(ctx, file));
		});
		ctx.addCommand({
			id: "find",
			name: t("talk.cmdFind"),
			icon: "search",
			checkCallback: activeFileCommand(ctx.core, isMedia, (file) => void find(ctx, file)),
		}, "file");
		ctx.addCommand({
			id: "taqrir",
			name: t("talk.cmdTaqrir"),
			icon: "scroll-text",
			checkCallback: activeFileCommand(ctx.core, isMedia, (file) => void taqrir(ctx, file)),
		}, "file");
	},
};
