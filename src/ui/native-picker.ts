// The operating system's file/folder dialog (Electron). Returns absolute paths.
// Falls back to a hidden <input type="file"> when the dialog API is not exposed to plugins.

export interface PickOptions {
	kind: "file" | "folder";
	multiple: boolean;
	/** Extensions with a leading dot, e.g. [".mp3", ".wav"]. */
	accept?: string[];
	defaultPath?: string;
	title?: string;
}

export interface DialogFilter {
	name: string;
	extensions: string[];
}

/** Dialog filters from an x-accept list: one filter with the accepted kinds, plus "All files". */
export function acceptToFilters(accept: string[] | undefined, allLabel = "All files"): DialogFilter[] {
	const extensions = [...new Set((accept ?? []).map((a) => a.replace(/^\./, "").toLowerCase()).filter(Boolean))];
	if (!extensions.length) return [];
	return [
		{ name: extensions.map((e) => `.${e}`).join(" "), extensions },
		{ name: allLabel, extensions: ["*"] },
	];
}

interface OpenDialogResult {
	canceled: boolean;
	filePaths: string[];
}

interface ElectronDialog {
	showOpenDialog(options: Record<string, unknown>): Promise<OpenDialogResult>;
}

interface ElectronModule {
	remote?: { dialog?: ElectronDialog };
	webUtils?: { getPathForFile(file: File): string };
}

function electron(): ElectronModule | undefined {
	const req = (window as unknown as { require?: (id: string) => unknown }).require;
	return req?.("electron") as ElectronModule | undefined;
}

function dialogApi(): ElectronDialog | undefined {
	const req = (window as unknown as { require?: (id: string) => unknown }).require;
	try {
		const dialog = electron()?.remote?.dialog;
		if (dialog) return dialog;
	} catch {
		/* try @electron/remote */
	}
	try {
		return (req?.("@electron/remote") as { dialog?: ElectronDialog } | undefined)?.dialog;
	} catch {
		return undefined;
	}
}

export async function pickPaths(options: PickOptions): Promise<string[]> {
	const dialog = dialogApi();
	if (dialog) {
		const properties = [options.kind === "folder" ? "openDirectory" : "openFile"];
		if (options.multiple) properties.push("multiSelections");
		if (options.kind === "folder") properties.push("createDirectory");
		const result = await dialog.showOpenDialog({
			title: options.title,
			defaultPath: options.defaultPath,
			properties,
			filters: options.kind === "file" ? acceptToFilters(options.accept) : undefined,
		});
		return result.canceled ? [] : result.filePaths;
	}
	return pickWithInput(options);
}

/** Fallback: the browser's own file chooser; real paths come from Electron's file.path / webUtils. */
function pickWithInput(options: PickOptions): Promise<string[]> {
	return new Promise((resolve) => {
		const input = createEl("input", { type: "file" });
		input.multiple = options.multiple;
		if (options.kind === "folder") input.setAttribute("webkitdirectory", "");
		else if (options.accept?.length) input.accept = options.accept.join(",");
		input.addEventListener("change", () => {
			const files = Array.from(input.files ?? []);
			const paths = files.map((file) => {
				const webUtils = electron()?.webUtils;
				const path = webUtils ? webUtils.getPathForFile(file) : (file as File & { path?: string }).path;
				return path ?? "";
			});
			// A folder choice yields every file inside; keep just the folder itself.
			if (options.kind === "folder") {
				const first = paths[0];
				const rel = files[0]?.webkitRelativePath ?? "";
				const top = rel.split("/")[0] ?? "";
				const idx = first && top ? first.lastIndexOf(`${top}`) : -1;
				resolve(first && idx >= 0 ? [first.slice(0, idx + top.length)] : []);
				return;
			}
			resolve(paths.filter(Boolean));
		});
		input.addEventListener("cancel", () => resolve([]));
		input.click();
	});
}
