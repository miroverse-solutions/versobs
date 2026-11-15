// Vault path <-> absolute path. Versline works on absolute paths; Obsidian on vault-relative ones.
import { type App, FileSystemAdapter, normalizePath, type TAbstractFile, TFile, TFolder } from "obsidian";

export class VaultPaths {
	constructor(private app: App) {}

	private get adapter(): FileSystemAdapter {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) throw new Error("Versobs needs a desktop vault on the file system.");
		return adapter;
	}

	base(): string {
		return this.adapter.getBasePath();
	}

	static isAbsolute(path: string): boolean {
		return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");
	}

	/** Absolute path of a vault path (absolute paths are returned unchanged). */
	abs(path: string): string {
		if (VaultPaths.isAbsolute(path)) return path;
		const clean = normalizePath(path || "/");
		return clean === "/" ? this.base() : this.adapter.getFullPath(clean);
	}

	/** Vault path of an absolute path inside the vault, else null. */
	toVault(absPath: string): string | null {
		const base = this.base().replace(/[\\/]+$/, "");
		const win = process.platform === "win32";
		const norm = (p: string) => (win ? p.replace(/\\/g, "/").toLowerCase() : p);
		const a = norm(absPath);
		const b = norm(base);
		if (a === b) return "";
		if (!a.startsWith(b + "/")) return null;
		return normalizePath(absPath.slice(base.length + 1).replace(/\\/g, "/"));
	}

	folderOf(file: TAbstractFile): string {
		if (file instanceof TFolder) return file.path === "/" ? "" : file.path;
		return file.parent && file.parent.path !== "/" ? file.parent.path : "";
	}

	/** Join vault path parts, normalized, without a leading slash. */
	static join(...parts: string[]): string {
		const joined = parts.filter((p) => p && p !== "/").join("/");
		return joined ? normalizePath(joined) : "";
	}

	async ensureFolder(path: string): Promise<void> {
		if (!path || path === "/") return;
		if (this.app.vault.getFolderByPath(path)) return;
		try {
			await this.app.vault.createFolder(path);
		} catch {
			// created concurrently, or exists on disk but not yet indexed
		}
	}

	/** Wait until a file written by Versline shows up in the vault index. */
	async waitForFile(vaultPath: string, timeoutMs = 5000): Promise<TFile | null> {
		const started = Date.now();
		while (Date.now() - started < timeoutMs) {
			const file = this.app.vault.getFileByPath(vaultPath);
			if (file) return file;
			await sleep(150);
		}
		return this.app.vault.getFileByPath(vaultPath);
	}
}

/** Local time as "YYYY-MM-DD HHmm" (or with a custom separator), for file names and properties. */
export function timestamp(date = new Date(), withTime = true, timeSep = " "): string {
	const p = (n: number) => String(n).padStart(2, "0");
	const day = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
	return withTime ? `${day}${timeSep}${p(date.getHours())}${timeSep === "T" ? ":" : ""}${p(date.getMinutes())}` : day;
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Remove characters that are invalid in file names on any OS (and Obsidian's link characters). */
export function safeFileName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 180);
}
