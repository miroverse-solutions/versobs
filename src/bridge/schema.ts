// Helpers over tool parameter schemas: field lists, defaults, output patterns, coercion. Pure, unit-tested.
import type { ObjectSchema, ParamSchema, ToolSpec } from "./protocol";

export interface Field {
	key: string;
	schema: ParamSchema;
	required: boolean;
	advanced: boolean;
}

export function fieldsOf(spec: ToolSpec | ObjectSchema): Field[] {
	const schema = "params" in spec ? spec.params : spec;
	const required = new Set(schema.required ?? []);
	return Object.entries(schema.properties ?? {}).map(([key, prop]) => ({
		key,
		schema: prop,
		required: required.has(key),
		advanced: prop["x-advanced"] === true,
	}));
}

export function defaultsOf(spec: ToolSpec): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const field of fieldsOf(spec)) {
		if (field.schema.default !== undefined && field.schema.default !== null) {
			values[field.key] = structuredClone(field.schema.default);
		}
	}
	return values;
}

/** Path-like widgets: values are vault paths in the UI and absolute paths for Versline. */
export function isPathWidget(prop: ParamSchema): boolean {
	const w = prop["x-widget"];
	return w === "file" || w === "files" || w === "folder" || w === "output-file" || w === "output-folder";
}

export interface PathParts {
	dir: string;
	stem: string;
	ext: string;
	name: string;
	path: string;
}

export function splitPath(path: string): PathParts {
	const clean = path.replace(/[\\/]+$/, "");
	const slash = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
	const dir = slash >= 0 ? clean.slice(0, slash) : "";
	const name = slash >= 0 ? clean.slice(slash + 1) : clean;
	const dot = name.lastIndexOf(".");
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : "";
	return { dir, stem, ext, name, path: clean };
}

/** Expand an x-output pattern such as "{dir}/{stem}_summary_{mode}.md" from the first input and other values. */
export function expandPattern(pattern: string, input: string, values: Record<string, unknown> = {}): string {
	const parts = splitPath(input);
	let result = pattern.replace(/\{(\w+)\}/g, (_, name: string) => {
		if (name in parts) return parts[name as keyof PathParts];
		return asText(values[name]);
	});
	result = result.replace(/\/{2,}/g, "/");
	return parts.dir ? result : result.replace(/^\//, "");
}

/** Coerce raw form values (strings from inputs) to the types the schema expects; drop empty optionals. */
export function coerce(spec: ToolSpec, raw: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const field of fieldsOf(spec)) {
		const value = raw[field.key];
		if (value === undefined) continue;
		const type = field.schema.type;
		// Empty means "use the default"; a missing required value is reported by missingRequired().
		if (value === "" || value === null) continue;
		if ((type === "integer" || type === "number") && typeof value === "string") {
			const num = type === "integer" ? parseInt(value, 10) : parseFloat(value);
			if (!Number.isNaN(num)) out[field.key] = num;
			continue;
		}
		if (type === "array" && typeof value === "string") {
			out[field.key] = value
				.split(/[,،\n]/)
				.map((s) => s.trim())
				.filter(Boolean);
			continue;
		}
		out[field.key] = value;
	}
	return out;
}

/** Return the keys of required fields that are missing or empty. */
export function missingRequired(spec: ToolSpec, values: Record<string, unknown>): string[] {
	return fieldsOf(spec)
		.filter((f) => f.required)
		.filter((f) => {
			const v = values[f.key];
			return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
		})
		.map((f) => f.key);
}

/** Text for a form value: strings and numbers as they are, anything else as JSON, nothing as "". */
export function asText(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}

export function acceptsExtension(prop: ParamSchema, ext: string): boolean {
	const accept = prop["x-accept"];
	if (!accept || accept.length === 0) return true;
	const normalized = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
	return accept.includes(normalized);
}

/** The first file/files field of a tool, used to prefill from the active file. */
export function primaryInput(spec: ToolSpec): Field | undefined {
	return fieldsOf(spec).find((f) => f.schema["x-widget"] === "files" || f.schema["x-widget"] === "file");
}

export function primaryOutput(spec: ToolSpec): Field | undefined {
	return fieldsOf(spec).find((f) => f.schema["x-widget"] === "output-file" || f.schema["x-widget"] === "output-folder");
}

/** File stem of a file path (vault or absolute); null for links, which have no file name to reuse. */
export function inputStem(input: string): string | null {
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) && !/^file:/i.test(input)) return null;
	return splitPath(input).stem || null;
}

export interface OutputParts {
	/** Folder part ("" = vault root / unspecified). */
	folder: string;
	/** File name without extension (for an output folder: the folder's own name). */
	name: string;
	/** Extension with the dot (".md"), or "". */
	ext: string;
}

/** Split an output value into folder + name + extension so each can be edited on its own. */
export function splitOutput(value: string, kind: "file" | "folder"): OutputParts {
	const parts = splitPath(value);
	let folder = parts.dir;
	if (!folder && /^[\\/]/.test(value.trim())) folder = "/";
	if (/^[a-zA-Z]:$/.test(folder)) folder += "/";
	if (kind === "folder") return { folder, name: parts.name, ext: "" };
	return { folder, name: parts.stem, ext: parts.ext };
}

/** Inverse of splitOutput. An empty name gives "" (the tool's default is used); a typed extension is not doubled. */
export function joinOutput({ folder, name, ext }: OutputParts): string {
	const base = name.trim();
	if (!base) return "";
	const file = ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? base + ext : base;
	if (!folder) return file;
	return /[\\/]$/.test(folder) ? folder + file : `${folder}/${file}`;
}
