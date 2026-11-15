// Find the `versline` executable. Obsidian started from a desktop launcher often lacks the shell's PATH
// (notably on macOS), so the usual install locations are checked as well. No Obsidian imports.
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";

export interface LocateEnv {
	platform: NodeJS.Platform;
	env: Record<string, string | undefined>;
	home: string;
}

export function currentEnv(): LocateEnv {
	return { platform: process.platform, env: process.env, home: homedir() };
}

/** Candidate paths in priority order (pure). */
export function candidatePaths({ platform, env, home }: LocateEnv): string[] {
	const win = platform === "win32";
	const exe = win ? "versline.exe" : "versline";
	const join_ = (...parts: string[]) => (win ? parts.join("\\") : parts.join("/"));
	const dirs: string[] = [];

	const pathVar = env.PATH ?? env.Path ?? "";
	dirs.push(...pathVar.split(win ? ";" : ":").filter(Boolean));

	if (win) {
		const local = env.LOCALAPPDATA ?? join_(home, "AppData", "Local");
		dirs.push(join_(local, "Versline")); // install.ps1 (self-contained bundle)
		dirs.push(join_(home, ".local", "bin")); // uv tool install
		dirs.push(join_(env.APPDATA ?? join_(home, "AppData", "Roaming"), "uv", "tools", "versline", "Scripts"));
	} else {
		dirs.push(join_(home, ".local", "bin")); // uv tool install / pipx
		if (env.XDG_BIN_HOME) dirs.push(env.XDG_BIN_HOME);
		dirs.push(join_(home, ".cargo", "bin"));
		dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin");
	}

	const seen = new Set<string>();
	const result: string[] = [];
	for (const dir of dirs) {
		const candidate = join_(dir.replace(/[\\/]+$/, ""), exe);
		const key = win ? candidate.toLowerCase() : candidate;
		if (!seen.has(key)) {
			seen.add(key);
			result.push(candidate);
		}
	}
	return result;
}

function isExecutable(path: string): boolean {
	try {
		if (!statSync(path).isFile()) return false;
		accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** The configured path if it is executable, else the first candidate that exists. */
export function locateVersline(configured?: string, env: LocateEnv = currentEnv()): string | null {
	if (configured && configured.trim()) {
		const path = configured.trim().replace(/^~(?=$|[\\/])/, env.home);
		return isExecutable(path) ? path : null;
	}
	for (const candidate of candidatePaths(env)) {
		if (isExecutable(candidate)) return candidate;
	}
	return null;
}

export function installCommand(platform: NodeJS.Platform = process.platform): string {
	return platform === "win32"
		? "irm https://raw.githubusercontent.com/miroverse-solutions/versline/main/install.ps1 | iex"
		: "curl -LsSf https://raw.githubusercontent.com/miroverse-solutions/versline/main/install.sh | sh";
}

