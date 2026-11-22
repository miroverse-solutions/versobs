// Warnings a successful job reports in its result (e.g. time ranges a transcription had to skip).
import { joinList, t } from "../i18n";

export interface SkippedRange {
	start_label: string;
	end_label: string;
	models?: string[];
}

export interface JobWarning {
	kind?: string;
	input?: string;
	/** Absolute path of the output the warning is about. */
	output?: string;
	message: string;
	ranges?: SkippedRange[];
}

/** The `warnings` of a result, ignoring anything malformed (older or newer Versline). */
export function resultWarnings(data: Record<string, unknown> | undefined | null): JobWarning[] {
	const list = data?.warnings;
	if (!Array.isArray(list)) return [];
	return list.filter(
		(w): w is JobWarning => !!w && typeof w === "object" && typeof (w as JobWarning).message === "string",
	);
}

/** A warning in the plugin's language when its kind is known, otherwise Versline's own message. */
export function warningText(warning: JobWarning): string {
	if (warning.kind !== "skipped_ranges" || !warning.ranges?.length) return warning.message;
	const models: string[] = [];
	for (const range of warning.ranges) for (const m of range.models ?? []) if (!models.includes(m)) models.push(m);
	const name = (warning.input ?? "").split(/[\\/]/).pop() ?? "";
	return t("transcribe.skippedBody", {
		name,
		ranges: joinList(warning.ranges.map((r) => t("transcribe.skippedRange", { start: r.start_label, end: r.end_label }))),
		models: models.join(" / "),
	});
}
