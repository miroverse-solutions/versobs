// Plugin settings (data.json). Versioned, with per-module namespaces so modules can be added freely.
import type { LanguageSetting } from "../i18n";

export const SETTINGS_VERSION = 1;

export type OutputPlacement = "beside" | "folder";

export interface VersobsSettings {
	version: number;
	language: LanguageSetting;

	/** Path to the versline executable; empty = find it automatically. */
	verslinePath: string;
	/** Folder for Versline caches; empty = Versline's default (outside the vault). */
	workdir: string;
	debugLogs: boolean;
	concurrency: number;
	/** How many times Versline tries each API call before giving up (VERSLINE_MAX_RETRIES). */
	maxRetries: number;

	/** Where new notes go: next to their source, or in one folder. */
	outputPlacement: OutputPlacement;
	outputFolder: string;
	/** Add versline_* properties to generated notes (for Bases and search). */
	stampProperties: boolean;
	openResults: boolean;
	notifyOnFinish: boolean;
	checkUpdates: boolean;

	/** Use the model/key below for jobs from this vault instead of Versline's saved settings. */
	vaultLlm: boolean;
	llmProvider: string;
	llmModel: string;
	llmEndpoint: string;
	llmProxy: string;
	/** Name of a secret in Obsidian's SecretStorage holding the API key (not the key itself). */
	llmApiKeySecret: string;

	/** Enabled state per module id (missing = the module's default). */
	modules: Record<string, boolean>;
	/** Per-module settings: moduleSettings[moduleId][key]. */
	moduleSettings: Record<string, Record<string, unknown>>;
	/** Last used options per tool (paths excluded), to prefill forms. */
	lastParams: Record<string, Record<string, unknown>>;
}

export const DEFAULT_SETTINGS: VersobsSettings = {
	version: SETTINGS_VERSION,
	language: "auto",
	verslinePath: "",
	workdir: "",
	debugLogs: false,
	concurrency: 2,
	maxRetries: 3,
	outputPlacement: "beside",
	outputFolder: "Versline",
	stampProperties: true,
	openResults: true,
	notifyOnFinish: true,
	checkUpdates: true,
	vaultLlm: false,
	llmProvider: "",
	llmModel: "",
	llmEndpoint: "",
	llmProxy: "",
	llmApiKeySecret: "",
	modules: {},
	moduleSettings: {},
	lastParams: {},
};

/** Merge stored data over defaults and migrate older versions. */
export function migrateSettings(stored: unknown): VersobsSettings {
	const data = (stored && typeof stored === "object" ? stored : {}) as Partial<VersobsSettings>;
	const settings: VersobsSettings = {
		...structuredClone(DEFAULT_SETTINGS),
		...data,
		modules: { ...(data.modules ?? {}) },
		moduleSettings: { ...(data.moduleSettings ?? {}) },
		lastParams: { ...(data.lastParams ?? {}) },
	};
	// Future migrations: if ((data.version ?? 0) < 2) { ... }
	settings.version = SETTINGS_VERSION;
	settings.concurrency = Math.min(8, Math.max(1, Math.round(settings.concurrency || 1)));
	settings.maxRetries = Math.min(10, Math.max(1, Math.round(settings.maxRetries || 3)));
	return settings;
}

/** Read a dotted key ("moduleSettings.transcribe.folder") from an object. */
export function getPath(root: unknown, key: string): unknown {
	return key.split(".").reduce<unknown>((node, part) => {
		if (node && typeof node === "object") return (node as Record<string, unknown>)[part];
		return undefined;
	}, root);
}

export function setPath(root: Record<string, unknown>, key: string, value: unknown): void {
	const parts = key.split(".");
	let node: Record<string, unknown> = root;
	for (const part of parts.slice(0, -1)) {
		const next = node[part];
		if (!next || typeof next !== "object") node[part] = {};
		node = node[part] as Record<string, unknown>;
	}
	node[parts[parts.length - 1] as string] = value;
}
