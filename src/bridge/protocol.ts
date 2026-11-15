// Types and parsing for Versline's bridge protocol (`versline bridge info` / `versline bridge run`).
// Mirrors src/versline/bridge/protocol.py in the Versline repository. No Obsidian imports: unit-tested.

export const SUPPORTED_PROTOCOL = 1;

export interface Bilingual {
	en: string;
	fa: string;
	[lang: string]: string;
}

export interface ParamSchema {
	type?: "string" | "integer" | "number" | "boolean" | "array" | "object";
	default?: unknown;
	description?: string;
	enum?: (string | number)[];
	items?: ParamSchema;
	nullable?: boolean;
	minimum?: number;
	maximum?: number;
	minItems?: number;
	minLength?: number;
	additionalProperties?: boolean | ParamSchema;
	"x-label"?: Bilingual;
	"x-help"?: Bilingual;
	"x-widget"?: Widget;
	"x-accept"?: string[];
	"x-advanced"?: boolean;
	"x-output"?: string;
	"x-choices"?: Record<string, Bilingual>;
}

export type Widget =
	| "file"
	| "files"
	| "folder"
	| "text"
	| "textarea"
	| "secret"
	| "output-file"
	| "output-folder"
	| "date"
	| "tags";

export interface ObjectSchema {
	type: "object";
	properties?: Record<string, ParamSchema>;
	required?: string[];
	additionalProperties?: boolean;
}

export interface ToolSpec {
	name: string;
	category: string;
	title: Bilingual;
	description: Bilingual;
	needs_llm: boolean;
	interactive: boolean;
	hidden: boolean;
	tags: string[];
	params: ObjectSchema;
}

export interface Manifest {
	versline: string;
	protocol: number;
	tools: ToolSpec[];
}

export interface LlmOverrides {
	provider?: string;
	model?: string;
	api_key?: string;
	api_endpoint?: string;
	proxy?: string;
}

export interface RunRequest {
	params: Record<string, unknown>;
	llm?: LlmOverrides;
	workdir?: string;
}

export interface Artifact {
	path: string;
	kind: string;
	exists: boolean;
}

export interface CostInfo {
	input_tokens: number;
	output_tokens: number;
	cached_tokens: number;
	usd: number | null;
	irt: number | null;
	error: string | null;
}

export type PromptKind = "phone" | "code" | "password" | "api_id" | "api_hash" | "confirm" | null;

export type BridgeEvent =
	| { type: "hello"; versline: string; protocol: number; tool: string }
	| { type: "progress"; current: number | null; total: number | null; label: string | null }
	| { type: "log"; level: string; message: string }
	| {
			type: "prompt";
			id: string;
			message: string;
			secret: boolean;
			kind: PromptKind;
			default: string | null;
			choices: string[] | null;
	  }
	| ({ type: "artifact" } & Artifact)
	| ({ type: "cost" } & CostInfo)
	| { type: "result"; data: Record<string, unknown>; artifacts: Artifact[] }
	| { type: "error"; code: string; message: string };

export type ErrorCode =
	| "not_found"
	| "outdated"
	| "spawn"
	| "unknown_tool"
	| "invalid_params"
	| "bad_input"
	| "failed"
	| "cancelled"
	| "exception"
	| "internal"
	| "protocol";

/** Splits a byte stream into NDJSON events; tolerates partial lines and non-JSON noise. */
export class LineDecoder {
	private buffer = "";

	push(chunk: string): BridgeEvent[] {
		this.buffer += chunk;
		const lines = this.buffer.split(/\r?\n/);
		this.buffer = lines.pop() ?? "";
		return lines.map(parseEvent).filter((e): e is BridgeEvent => e !== null);
	}

	flush(): BridgeEvent[] {
		const rest = this.buffer;
		this.buffer = "";
		const event = parseEvent(rest);
		return event ? [event] : [];
	}
}

export function parseEvent(line: string): BridgeEvent | null {
	const text = line.trim();
	if (!text.startsWith("{")) return null;
	try {
		const value = JSON.parse(text) as { type?: unknown };
		return typeof value.type === "string" ? (value as BridgeEvent) : null;
	} catch {
		return null;
	}
}

export function isManifest(value: unknown): value is Manifest {
	const m = value as Manifest;
	return !!m && typeof m.versline === "string" && typeof m.protocol === "number" && Array.isArray(m.tools);
}
