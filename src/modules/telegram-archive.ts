// Reads what Versline's `.versline-channel.json` says about an archive folder, so a folder archived earlier
// can be run again for its documents (telegram.archive with to_markdown) without asking for the channel.

export interface ArchiveInfo {
	/** The channel as Versline accepts it: @username, else the numeric id. */
	channel: string;
	title: string;
	/** Dates (YYYY-MM-DD) of the first and last archived post; limit the rerun to that range. */
	since: string | null;
	until: string | null;
	/** Archived posts that have a document converted to Markdown already. */
	converted: number;
	posts: number;
}

interface ManifestEntry {
	status?: string;
	date?: string;
	merged_into?: unknown;
	documents?: { note?: string }[];
}

interface Manifest {
	channel?: { title?: string; username?: string | null; id?: number | null };
	posts?: Record<string, ManifestEntry>;
}

/** Parse a manifest's text; null when it is not an archive manifest or names no channel. */
export function parseArchiveManifest(text: string): ArchiveInfo | null {
	let data: Manifest;
	try {
		data = JSON.parse(text) as Manifest;
	} catch {
		return null;
	}
	const channel = data?.channel;
	if (!channel || typeof channel !== "object") return null;
	const ref = channel.username ? `@${channel.username}` : channel.id ? String(channel.id) : "";
	if (!ref) return null;
	const done = Object.values(data.posts ?? {}).filter((p) => p?.status === "done" && !p.merged_into);
	const dates = done
		.map((p) => (typeof p.date === "string" ? p.date.slice(0, 10) : ""))
		.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
		.sort();
	return {
		channel: ref,
		title: channel.title || ref,
		since: dates[0] ?? null,
		until: dates[dates.length - 1] ?? null,
		converted: done.filter((p) => p.documents?.some((d) => d.note)).length,
		posts: done.length,
	};
}
