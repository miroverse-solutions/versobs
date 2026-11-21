// Small helpers shared by feature modules.
import { type Editor, type Menu, Notice, type TAbstractFile, TFile } from "obsidian";
import type { RunResult, Versobs } from "../core/versobs";
import { type MessageKey, t } from "../i18n";

export const MEDIA_EXT = new Set([
	"mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "amr",
	"mp4", "mkv", "mov", "avi", "webm", "m4v", "flv", "wmv", "mpeg", "mpg", "3gp",
]);
export const NOTE_EXT = new Set(["md", "markdown", "txt"]);
export const DOCUMENT_EXT = new Set([...NOTE_EXT, "pdf", "docx", "pptx", "html", "htm", "epub", "xlsx", "csv"]);

export const isMedia = (f: TAbstractFile | null): f is TFile => f instanceof TFile && MEDIA_EXT.has(f.extension.toLowerCase());
export const isNote = (f: TAbstractFile | null): f is TFile => f instanceof TFile && NOTE_EXT.has(f.extension.toLowerCase());
export const isMarkdown = (f: TAbstractFile | null): f is TFile => f instanceof TFile && f.extension.toLowerCase() === "md";
export const isDocument = (f: TAbstractFile | null): f is TFile =>
	f instanceof TFile && DOCUMENT_EXT.has(f.extension.toLowerCase());

/** Add an entry to a file/editor menu, grouped with the other Versline entries. */
export function addMenuItem(menu: Menu, title: string, icon: string, onClick: () => void): void {
	menu.addItem((item) => item.setTitle(title).setIcon(icon).setSection("versobs").onClick(onClick));
}

/** Localized output name, e.g. tpl.summary with {stem: "lecture"} -> "lecture - summary". */
export function outputName(key: MessageKey, vars: Record<string, string>): string {
	return t(key, vars);
}

/** Entry for a multi-selection (files-menu): shown when at least two of the selected files are accepted. */
export function addFilesMenuItem(
	menu: Menu,
	files: TAbstractFile[],
	accept: (f: TAbstractFile | null) => boolean,
	title: (count: number) => string,
	icon: string,
	run: (files: TFile[]) => void,
): void {
	const matching = files.filter((f): f is TFile => f instanceof TFile && accept(f));
	if (matching.length < 2) return;
	addMenuItem(menu, title(matching.length), icon, () => run(matching));
}

/** "Command for the active file" with a check callback. */
export function activeFileCommand(
	core: Versobs,
	accept: (file: TFile | null) => boolean,
	run: (file: TFile) => void,
): (checking: boolean) => boolean {
	return (checking) => {
		const file = core.app.workspace.getActiveFile();
		if (!file || !accept(file)) return false;
		if (!checking) run(file);
		return true;
	};
}

/** Insert text after the front matter (or at the top). */
export function afterFrontmatter(content: string, insert: string): string {
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
	if (!match) return insert + content;
	return content.slice(0, match[0].length) + insert + content.slice(match[0].length);
}

export function callout(type: string, title: string, body: string): string {
	const lines = body.trim().split(/\r?\n/).map((l) => (l ? `> ${l}` : ">"));
	return `> [!${type}] ${title}\n${lines.join("\n")}\n`;
}

export type InsertMode = "replace" | "below" | "callout";

/** Put a text result back into the editor around the selection. */
export function insertResult(editor: Editor, text: string, mode: InsertMode, title: string, calloutType = "note"): void {
	const selection = editor.getSelection();
	if (mode === "replace") {
		editor.replaceSelection(text.trim());
		return;
	}
	const block = mode === "callout" ? callout(calloutType, title, text) : text.trim();
	editor.replaceSelection(`${selection}\n\n${block}\n`);
}

/** A notice listing a job's output files; click opens notes in Obsidian, other files with the system app. */
export function notifyOutputs(core: Versobs, result: RunResult | null, heading?: string): void {
	if (!result || result.outcome.status !== "success") return;
	const files = result.outcome.artifacts.filter((a) => a.exists);
	if (!files.length) return;
	const fragment = createFragment();
	fragment.append(heading ?? t("notice.outputs", { count: files.length }));
	for (const artifact of files.slice(0, 6)) {
		const vaultPath = core.paths.toVault(artifact.path);
		const name = (vaultPath ?? artifact.path).split(/[\\/]/).pop() ?? artifact.path;
		const link = createEl("a", { text: name, cls: "versobs-notice-link" });
		link.addEventListener("click", () => {
			if (vaultPath !== null && /\.(md|pdf|png|jpe?g|canvas)$/i.test(artifact.path)) {
				void core.app.workspace.openLinkText(vaultPath, "", true);
			} else {
				void core.openExternal(artifact.path);
			}
		});
		fragment.append(createEl("br"), link);
	}
	new Notice(fragment, 10000);
}

export function selectionCommandGuard(editor: Editor): string | null {
	const text = editor.getSelection();
	if (!text.trim()) {
		new Notice(t("notice.selectText"));
		return null;
	}
	return text;
}
