// Telegram: log in (phone + code asked in Obsidian), browse chats, archive a channel into the vault,
// write a taqrir of a discussion, build the pack of an archive folder, turn a channel's documents (PDF, Word,
// PowerPoint…) into Markdown notes, and answer the requests the user left as replies to talks in their requests
// chat (a taqrir, or passages found in the talk).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FuzzySuggestModal, Notice, type Setting, type TextComponent, TFolder } from "obsidian";
import { asText } from "../bridge/schema";
import type { ModuleContext, VersobsModule } from "../core/module";
import { safeFileName, VaultPaths } from "../core/paths";
import { applyDirection, t } from "../i18n";
import { addMenuItem, notifyOutputs } from "./_shared";
import { type ArchiveInfo, parseArchiveManifest } from "./telegram-archive";

interface Chat {
	id: number;
	kind: string | null;
	title: string;
	username: string | null;
}

interface TelegramStatus {
	credentials: boolean;
	account: string | null;
	error: string | null;
}

const ARCHIVE_MARKER = ".versline-channel.json";

function chatFolder(ctx: ModuleContext, ref: string): string {
	const base = ctx.get<string>("folder")?.trim() || "Telegram";
	const name = safeFileName(ref.replace(/^https?:\/\/t\.me\/(s\/)?/i, "").replace(/^@/, "")) || "chat";
	return VaultPaths.join(base, name);
}

async function archive(ctx: ModuleContext, channel = ""): Promise<void> {
	const core = ctx.core;
	const base = ctx.get<string>("folder")?.trim() || "Telegram";
	const result = await core.runTool({
		tool: "telegram.archive",
		title: t("telegram.archiveTitle", { name: channel || "…" }),
		values: { channel, output: base },
		intro: t("telegram.archiveIntro", { folder: base }),
		// The default output is the Telegram folder; put each channel in its own sub-folder.
		transform: (v) => ({ ...v, output: v.output === base ? chatFolder(ctx, asText(v.channel)) : v.output }),
	});
	if (result?.outcome.status === "success") {
		notifyOutputs(core, result, t("telegram.archiveDone"));
		await core.finish(result, { stamp: false, open: false });
	}
}

/** Whether the installed Versline can turn documents into Markdown (telegram.archive has the to_markdown option). */
async function requireDocumentSupport(ctx: ModuleContext): Promise<boolean> {
	const spec = await ctx.core.requireTool("telegram.archive");
	if (!spec) return false;
	if (!spec.params?.properties?.to_markdown) {
		new Notice(t("telegram.documentsOutdated"), 10000);
		return false;
	}
	return true;
}

/** Documents of a channel as Markdown notes: documents/<file>.md next to the posts, linked from each post note. */
async function archiveDocuments(ctx: ModuleContext, channel = ""): Promise<void> {
	if (!(await requireDocumentSupport(ctx))) return;
	const core = ctx.core;
	const base = ctx.get<string>("folder")?.trim() || "Telegram";
	const result = await core.runTool({
		tool: "telegram.archive",
		title: t("telegram.documentsTitle", { name: channel || "…" }),
		values: { channel, output: base, types: ["document"], to_markdown: true },
		intro: t("telegram.documentsIntro", { folder: base }),
		remember: false, // keep "documents only" out of the options remembered for normal archives
		transform: (v) => ({ ...v, output: v.output === base ? chatFolder(ctx, asText(v.channel)) : v.output }),
	});
	if (result?.outcome.status === "success") {
		notifyOutputs(core, result, t("telegram.documentsDone"));
		await core.finish(result, { stamp: false, open: false });
	}
}

/** Add documents as Markdown to an archive folder made earlier: the channel and date range come from its manifest. */
async function documentsForFolder(ctx: ModuleContext, folder: TFolder, info: ArchiveInfo): Promise<void> {
	if (!(await requireDocumentSupport(ctx))) return;
	const core = ctx.core;
	const result = await core.runTool({
		tool: "telegram.archive",
		title: t("telegram.documentsTitle", { name: info.title }),
		values: {
			channel: info.channel,
			output: folder.path,
			since: info.since,
			until: info.until,
			types: ["document"],
			to_markdown: true,
		},
		intro: t("telegram.documentsFolderIntro", { folder: folder.path, from: info.since ?? "…", to: info.until ?? "…" }),
		hidden: ["channel", "output", "since", "until"],
		remember: false,
	});
	if (result?.outcome.status === "success") {
		notifyOutputs(core, result, t("telegram.documentsDone"));
		await core.finish(result, { stamp: false, open: false });
	}
}

function readArchiveInfo(ctx: ModuleContext, folder: TFolder): ArchiveInfo | null {
	try {
		return parseArchiveManifest(readFileSync(join(ctx.core.paths.abs(folder.path), ARCHIVE_MARKER), "utf8"));
	} catch {
		return null;
	}
}

async function taqrir(ctx: ModuleContext, chat = ""): Promise<void> {
	const core = ctx.core;
	const base = ctx.get<string>("folder")?.trim() || "Telegram";
	const result = await core.runTool({
		tool: "telegram.taqrir",
		title: t("telegram.taqrirTitle", { name: chat || "…" }),
		values: { chat, output: base },
		transform: (v) => ({
			...v,
			output: v.output === base ? VaultPaths.join(chatFolder(ctx, asText(v.chat)), t("tpl.taqrir")) : v.output,
		}),
	});
	await core.finish(result, { stamp: false });
}

interface RequestsData {
	processed?: number;
	failed?: number;
	pending?: unknown[];
}

async function answerRequests(ctx: ModuleContext): Promise<void> {
	const core = ctx.core;
	const base = ctx.get<string>("folder")?.trim() || "Telegram";
	const result = await core.runTool({
		tool: "telegram.requests",
		title: t("telegram.requestsTitle"),
		intro: t("telegram.requestsIntro"),
		values: { chat: ctx.get<string>("requestsChat")?.trim() || "me", output: VaultPaths.join(base, t("tpl.requests")) },
	});
	if (result?.outcome.status !== "success") return;
	const data = (result.outcome.data ?? {}) as RequestsData;
	const lines: string[] = [];
	if (data.pending?.length) lines.push(t("telegram.requestsPending", { count: data.pending.length }));
	else if (data.processed) lines.push(t("telegram.requestsDone", { count: data.processed }));
	else lines.push(t("telegram.requestsNone"));
	if (data.failed) lines.push(t("telegram.requestsFailed", { count: data.failed }));
	new Notice(lines.join("\n"), data.failed ? 0 : 8000);
	await core.finish(result, { open: false });
}

async function pack(ctx: ModuleContext, folder: TFolder): Promise<void> {
	const core = ctx.core;
	const result = await core.runTool({
		tool: "telegram.pack",
		title: t("telegram.packTitle", { name: folder.name }),
		values: { archive_dir: folder.path, output: `${folder.path}_pack` },
		hidden: ["archive_dir"],
	});
	notifyOutputs(core, result, t("telegram.packDone"));
}

async function login(ctx: ModuleContext, onDone?: () => void): Promise<void> {
	const core = ctx.core;
	const result = await core.runTool({
		tool: "telegram.login",
		title: t("telegram.login"),
		intro: t("telegram.loginIntro"),
		submitText: t("telegram.login"),
		remember: false,
	});
	const status = result?.outcome.data as TelegramStatus | undefined;
	if (result?.outcome.status === "success" && status?.account) {
		new Notice(t("telegram.loggedInAs", { name: status.account }));
	}
	onDone?.();
}

/** A chat as a reference Versline accepts: @username when there is one, else the numeric id. */
function chatRef(chat: Chat): string {
	return chat.username ? `@${chat.username}` : String(chat.id);
}

class ChatPicker extends FuzzySuggestModal<Chat> {
	/** Without `onChoose`, a channel is archived and any other chat gets a taqrir. */
	constructor(
		private ctx: ModuleContext,
		private chats: Chat[],
		private onChoose?: (ref: string, chat: Chat) => void,
		placeholder: string = t("telegram.pickChat"),
	) {
		super(ctx.app);
		applyDirection(this.modalEl);
		this.setPlaceholder(placeholder);
	}

	getItems(): Chat[] {
		return this.chats;
	}

	getItemText(chat: Chat): string {
		return `${chat.title}${chat.username ? ` @${chat.username}` : ""} (${chat.kind ?? ""} ${chat.id})`;
	}

	onChooseItem(chat: Chat): void {
		const ref = chatRef(chat);
		if (this.onChoose) this.onChoose(ref, chat);
		else if (chat.kind === "channel") void archive(this.ctx, ref);
		else void taqrir(this.ctx, ref);
	}
}

async function browseChats(
	ctx: ModuleContext,
	onChoose?: (ref: string, chat: Chat) => void,
	placeholder?: string,
): Promise<void> {
	if (!(await ctx.core.requireTool("telegram.chats"))) return;
	const notice = new Notice(t("telegram.loadingChats"), 0);
	try {
		const data = await ctx.core.bridge.call<{ chats: Chat[] }>("telegram.chats", { limit: 300 });
		notice.hide();
		new ChatPicker(ctx, data.chats, onChoose, placeholder).open();
	} catch (err) {
		notice.hide();
		new Notice(t("telegram.chatsFailed", { error: String((err as Error).message ?? err) }), 10000);
	}
}

function renderAccount(ctx: ModuleContext, setting: Setting): void {
	const core = ctx.core;
	setting.setDesc(t("telegram.checking"));
	const show = (status: TelegramStatus | null) => {
		setting.controlEl.empty();
		if (status?.account) {
			setting.setDesc(t("telegram.loggedInAs", { name: status.account }));
			setting.addButton((b) =>
				b.setButtonText(t("telegram.logout")).onClick(async () => {
					await core.runTool({ tool: "telegram.logout", skipForm: true, remember: false, title: t("telegram.logout") });
					refresh();
				}),
			);
		} else {
			setting.setDesc(status?.error ? t("telegram.statusError", { error: status.error }) : t("telegram.notLoggedIn"));
			setting.addButton((b) => b.setButtonText(t("telegram.login")).setCta().onClick(() => void login(ctx, refresh)));
		}
	};
	const refresh = () => {
		if (!core.bridge.has("telegram.status")) {
			setting.setDesc(t("status.missing"));
			return;
		}
		core.bridge
			.call<TelegramStatus>("telegram.status")
			.then(show)
			.catch((err: Error) => show({ credentials: false, account: null, error: err.message }));
	};
	refresh();
}

/** The chat whose replies are requests: typed in, or picked from the account's chats. */
function renderRequestsChat(ctx: ModuleContext, setting: Setting): void {
	setting.setDesc(t("telegram.requestsChatDesc"));
	let input: TextComponent | undefined;
	setting.addText((text) => {
		input = text;
		text
			.setPlaceholder("me")
			.setValue(ctx.get<string>("requestsChat") ?? "me")
			.onChange((value) => void ctx.set("requestsChat", value.trim() || "me"));
	});
	setting.addButton((b) =>
		b.setButtonText(t("telegram.pickRequestsChat")).onClick(() =>
			void browseChats(
				ctx,
				(ref) => {
					input?.setValue(ref);
					void ctx.set("requestsChat", ref);
				},
				t("telegram.pickRequestsChatPlaceholder"),
			),
		),
	);
}

export const telegramModule: VersobsModule = {
	id: "telegram",
	name: "module.telegram",
	description: "module.telegram.desc",
	tools: ["telegram.archive", "telegram.taqrir", "telegram.pack", "telegram.login", "telegram.requests"],
	defaults: { folder: "Telegram", requestsChat: "me" },
	settings: (ctx) => [
		{ name: t("telegram.account"), render: (setting) => renderAccount(ctx, setting) },
		{
			name: t("telegram.folder"),
			desc: t("telegram.folderDesc"),
			control: { type: "folder", key: ctx.key("folder"), defaultValue: "Telegram" },
		},
		{ name: t("telegram.requestsChat"), render: (setting) => renderRequestsChat(ctx, setting) },
	],
	load(ctx) {
		ctx.addCommand({ id: "archive", name: t("telegram.cmdArchive"), icon: "send", callback: () => void archive(ctx) }, "general");
		ctx.addCommand({ id: "taqrir", name: t("telegram.cmdTaqrir"), icon: "messages-square", callback: () => void taqrir(ctx) }, "general");
		ctx.addCommand({ id: "documents", name: t("telegram.cmdDocuments"), icon: "file-text", callback: () => void archiveDocuments(ctx) }, "general");
		ctx.addCommand({ id: "requests", name: t("telegram.cmdRequests"), icon: "inbox", callback: () => void answerRequests(ctx) }, "general");
		ctx.addCommand({ id: "chats", name: t("telegram.cmdChats"), icon: "contact", callback: () => void browseChats(ctx) });
		ctx.addCommand({ id: "login", name: t("telegram.cmdLogin"), icon: "log-in", callback: () => void login(ctx) });
		ctx.onFileMenu((menu, file) => {
			// The archive marker is a dot-file, which Obsidian does not index, so check the disk directly.
			if (file instanceof TFolder && existsSync(join(ctx.core.paths.abs(file.path), ARCHIVE_MARKER))) {
				addMenuItem(menu, t("telegram.menuPack"), "package", () => void pack(ctx, file));
				const info = readArchiveInfo(ctx, file);
				if (info) addMenuItem(menu, t("telegram.menuDocuments"), "file-text", () => void documentsForFolder(ctx, file, info));
			}
		});
	},
};
