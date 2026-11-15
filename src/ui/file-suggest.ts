// Autocomplete vault files or folders in a text input.
import { AbstractInputSuggest, type App, prepareFuzzySearch, TFile, TFolder, type TAbstractFile } from "obsidian";

export class PathSuggest extends AbstractInputSuggest<TAbstractFile> {
	constructor(
		app: App,
		private input: HTMLInputElement,
		private kind: "file" | "folder",
		private accept: string[] = [],
		private onPick?: (path: string) => void,
	) {
		super(app, input);
	}

	protected getSuggestions(query: string): TAbstractFile[] {
		const fuzzy = prepareFuzzySearch(query.trim());
		const items: TAbstractFile[] = [];
		for (const file of this.app.vault.getAllLoadedFiles()) {
			if (this.kind === "folder" ? !(file instanceof TFolder) : !(file instanceof TFile)) continue;
			if (file instanceof TFile && this.accept.length && !this.accept.includes(`.${file.extension.toLowerCase()}`)) continue;
			if (!query.trim() || fuzzy(file.path)) items.push(file);
			if (items.length >= 50) break;
		}
		return items;
	}

	renderSuggestion(file: TAbstractFile, el: HTMLElement): void {
		el.setText(file.path === "/" ? "/" : file.path);
	}

	override selectSuggestion(file: TAbstractFile): void {
		const path = file.path === "/" ? "" : file.path;
		if (this.onPick) {
			this.onPick(path);
			this.setValue("");
		} else {
			this.setValue(path);
			this.input.dispatchEvent(new Event("input"));
		}
		this.close();
	}
}
