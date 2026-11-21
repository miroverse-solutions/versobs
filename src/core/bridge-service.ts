// Knows where Versline is, whether it is usable, and how to run its tools with this vault's settings.
import { Events, type App } from "obsidian";
import { BridgeError, call, type ClientOptions, fetchManifest, runTool, type RunHandle } from "../bridge/client";
import { locateVersline } from "../bridge/locator";
import {
	type BridgeEvent,
	type LlmOverrides,
	type Manifest,
	SUPPORTED_PROTOCOL,
	type ToolSpec,
} from "../bridge/protocol";
import type { VersobsSettings } from "./settings";

export type BridgeState = "unknown" | "checking" | "ready" | "missing" | "outdated" | "error";

export interface VerslineConfig {
	path: string;
	values: Record<string, string>;
	secrets_set: string[];
	providers: string[];
	default_models: Record<string, string>;
	writable: string[];
}

export class BridgeService extends Events {
	state: BridgeState = "unknown";
	executable: string | null = null;
	manifest: Manifest | null = null;
	error: string | null = null;
	config: VerslineConfig | null = null;
	private pending: Promise<void> | null = null;

	constructor(
		private app: App,
		private settings: () => VersobsSettings,
	) {
		super();
	}

	private setState(state: BridgeState, error: string | null = null): void {
		this.state = state;
		this.error = error;
		this.trigger("change", state);
	}

	/** Locate Versline and load its tool manifest. Concurrent calls share one check. */
	refresh(): Promise<void> {
		this.pending ??= this.doRefresh().finally(() => (this.pending = null));
		return this.pending;
	}

	private async doRefresh(): Promise<void> {
		this.setState("checking");
		this.executable = locateVersline(this.settings().verslinePath);
		if (!this.executable) {
			this.manifest = null;
			this.setState("missing");
			return;
		}
		try {
			const manifest = await fetchManifest(this.baseOptions());
			if (manifest.protocol !== SUPPORTED_PROTOCOL) {
				this.manifest = null;
				this.setState("outdated", `protocol ${manifest.protocol}`);
				return;
			}
			this.manifest = manifest;
			this.setState("ready");
			void this.loadConfig();
		} catch (err) {
			this.manifest = null;
			const code = err instanceof BridgeError ? err.code : "spawn";
			if (code === "not_found") this.setState("missing");
			else if (code === "outdated") this.setState("outdated", String((err as Error).message));
			else this.setState("error", String((err as Error).message ?? err));
		}
	}

	async ready(): Promise<boolean> {
		if (this.state !== "ready") await this.refresh();
		return this.state === "ready";
	}

	get debug(): boolean {
		return this.settings().debugLogs;
	}

	tool(name: string): ToolSpec | undefined {
		return this.manifest?.tools.find((t) => t.name === name);
	}

	has(name: string): boolean {
		return !!this.tool(name);
	}

	private baseOptions(): ClientOptions {
		const s = this.settings();
		return {
			executable: this.executable ?? "versline",
			workdir: s.workdir.trim() || undefined,
			debug: s.debugLogs,
		};
	}

	/** Options for a job: the vault's API key travels in the environment, never on the command line. */
	options(): ClientOptions {
		const options = this.baseOptions();
		const s = this.settings();
		options.env = { VERSLINE_MAX_RETRIES: String(s.maxRetries) };
		if (s.vaultLlm && s.llmApiKeySecret) {
			const key = this.app.secretStorage.getSecret(s.llmApiKeySecret);
			if (key) options.env.VERSLINE_LLM_API_KEY = key;
		}
		return options;
	}

	llmOverrides(): LlmOverrides | undefined {
		const s = this.settings();
		if (!s.vaultLlm) return undefined;
		return {
			provider: s.llmProvider || undefined,
			model: s.llmModel || undefined,
			api_endpoint: s.llmEndpoint || undefined,
			proxy: s.llmProxy || undefined,
		};
	}

	run(tool: string, params: Record<string, unknown>, onEvent: (event: BridgeEvent) => void): RunHandle {
		return runTool(this.options(), tool, params, onEvent, this.llmOverrides());
	}

	/** Run a tool without UI and return its result data. */
	call<T = Record<string, unknown>>(tool: string, params: Record<string, unknown> = {}): Promise<T> {
		return call(this.options(), tool, params) as Promise<T>;
	}

	async loadConfig(): Promise<VerslineConfig | null> {
		if (!this.has("config.get")) return null;
		try {
			this.config = await this.call<VerslineConfig>("config.get");
			this.trigger("config", this.config);
		} catch (err) {
			console.warn("[versobs] could not read Versline settings", err);
		}
		return this.config;
	}

	async saveConfig(values: Record<string, string | null>): Promise<VerslineConfig> {
		this.config = await this.call<VerslineConfig>("config.set", { values });
		this.trigger("config", this.config);
		return this.config;
	}

	/** Model the next job will most likely use (for note properties). */
	currentModel(): string | undefined {
		const s = this.settings();
		if (s.vaultLlm && s.llmModel) return s.llmModel;
		return this.config?.values.VERSLINE_LLM_MODEL || undefined;
	}
}
