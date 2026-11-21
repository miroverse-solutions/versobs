// Pick a vault folder from a scrollable, searchable list (no typing needed), or name a new one.
import { type App, normalizePath, prepareFuzzySearch, SuggestModal } from "obsidian";
import { applyDirection, t } from "../i18n";
import { renderPath } from "./path-view";

interface FolderItem {
	path: string;
	create?: boolean;
}

export class FolderPickerModal extends SuggestModal<FolderItem> {
	constructor(
		app: App,
		private current: string,
		private onChoose: (path: string) => void,
	) {
		super(app);
		applyDirection(this.modalEl);
		this.setPlaceholder(t("form.chooseFolder"));
	}

	private rootLabel(): string {
		return this.app.vault.getName();
	}

	getSuggestions(query: string): FolderItem[] {
		const folders = this.app.vault
			.getAllFolders(true)
			.map((f) => (f.isRoot() ? "" : f.path))
			.sort((a, b) => a.localeCompare(b));
		const text = query.trim();
		if (!text) {
			const active = this.app.workspace.getActiveFile()?.parent;
			const first = [this.current, active && !active.isRoot() ? active.path : ""];
			const ordered = [...new Set([...first, ...folders])];
			return ordered.map((path) => ({ path }));
		}
		const fuzzy = prepareFuzzySearch(text);
		const found: FolderItem[] = folders.filter((path) => fuzzy(path || this.rootLabel())).map((path) => ({ path }));
		const typed = normalizePath(text);
		if (!folders.includes(typed)) found.push({ path: typed, create: true });
		return found;
	}

	renderSuggestion(item: FolderItem, el: HTMLElement): void {
		if (item.create) {
			el.createDiv({ text: t("form.newFolder", { name: item.path }) });
			return;
		}
		renderPath(el.createDiv(), item.path, "›", this.rootLabel());
	}

	onChooseSuggestion(item: FolderItem): void {
		this.onChoose(item.path);
	}
}
