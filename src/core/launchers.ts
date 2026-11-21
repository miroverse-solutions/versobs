// Tasks a user can start from the jobs panel. Modules register them (via ModuleContext.addCommand),
// so enabling or disabling a module adds or removes its tasks there too.
import { Events } from "obsidian";

/** "file": works on the current file; "general": needs nothing; "tools": the picker listing every Versline tool. */
export type LauncherScope = "file" | "general" | "tools";

export interface Launcher {
	id: string;
	name: string;
	icon: string;
	scope: LauncherScope;
	/** Whether the task applies right now (e.g. the current file has the right type). */
	available(): boolean;
	run(): void;
}

export class LauncherRegistry extends Events {
	private items = new Map<string, Launcher>();

	get list(): Launcher[] {
		return [...this.items.values()];
	}

	add(launcher: Launcher): void {
		this.items.set(launcher.id, launcher);
		this.trigger("change");
	}

	remove(id: string): void {
		if (this.items.delete(id)) this.trigger("change");
	}
}

/** Case-insensitive match of every word in the query against the task name. */
export function filterLaunchers(list: Launcher[], query: string): Launcher[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return list;
	return list.filter((l) => {
		const name = l.name.toLowerCase();
		return words.every((w) => name.includes(w));
	});
}

export interface LauncherGroups {
	/** Tasks for the current file (only when it has a file and the task applies). */
	forFile: Launcher[];
	/** Everything else that needs no file, plus file tasks that do not apply (hidden: they cannot run). */
	general: Launcher[];
	tools: Launcher[];
}

export function groupLaunchers(list: Launcher[], query: string): LauncherGroups {
	const found = filterLaunchers(list, query);
	return {
		forFile: found.filter((l) => l.scope === "file" && l.available()),
		general: found.filter((l) => l.scope === "general"),
		tools: found.filter((l) => l.scope === "tools"),
	};
}
