// Show a path so mixed Persian/English segments keep their own direction and "/" stays in place.

/** Fill `el` with the path's segments, each isolated with <bdi>, joined by a muted separator. */
export function renderPath(el: HTMLElement, path: string, separator = "/", emptyLabel = "/"): void {
	el.empty();
	el.addClass("versobs-path");
	const segments = path.split(/[\\/]+/).filter(Boolean);
	if (!segments.length) {
		el.createEl("bdi", { text: emptyLabel, cls: "versobs-path-seg" });
		return;
	}
	if (/^[\\/]/.test(path)) el.createSpan({ text: "/", cls: "versobs-path-sep" });
	segments.forEach((segment, index) => {
		if (index > 0) el.createSpan({ text: ` ${separator} `, cls: "versobs-path-sep" });
		el.createEl("bdi", { text: segment, cls: "versobs-path-seg" });
	});
}
