// Settings, declared with Obsidian 1.13's getSettingDefinitions(): Versline status, AI service (written to
// Versline's own config), a per-vault override with the key in SecretStorage, general options, modules, advanced.
import {
	ConfirmationModal,
	debounce,
	Notice,
	PluginSettingTab,
	type Setting,
	type SettingDefinitionItem,
} from "obsidian";
import { getLanguage } from "obsidian";
import { applyDirection, formatNumber, type LanguageSetting, LANGUAGES, resolveLanguage, setLanguage, t } from "../i18n";
import type VersobsPlugin from "../main";
import { getPath, setPath } from "./settings";

const VERSLINE_PREFIX = "versline:";
const KEY = {
	provider: "VERSLINE_LLM_PROVIDER",
	model: "VERSLINE_LLM_MODEL",
	endpoint: "VERSLINE_LLM_API_ENDPOINT",
	proxy: "VERSLINE_LLM_PROXY",
	apiKey: "VERSLINE_LLM_API_KEY",
	telegramProxy: "VERSLINE_TELEGRAM_PROXY",
};
const FALLBACK_PROVIDERS = ["Google", "OpenAI", "OpenRouter", "AvalAI", "OpenAICompatible"];

export class VersobsSettingTab extends PluginSettingTab {
	private pendingVersline: Record<string, string | null> = {};
	private loadingConfig = false;
	private flushVersline = debounce(() => void this.writeVersline(), 900, true);
	private refreshBridge = debounce(() => void this.plugin.core.bridge.refresh(), 900, true);

	constructor(private plugin: VersobsPlugin) {
		super(plugin.app, plugin);
		this.icon = "audio-waveform";
	}

	private get core() {
		return this.plugin.core;
	}

	override getControlValue(key: string): unknown {
		if (key.startsWith(VERSLINE_PREFIX)) {
			const name = key.slice(VERSLINE_PREFIX.length);
			return this.pendingVersline[name] ?? this.core.bridge.config?.values[name] ?? "";
		}
		if (key.startsWith("modules.")) {
			const module = this.plugin.host.modules.find((m) => m.id === key.slice("modules.".length));
			return module ? this.plugin.host.isEnabled(module) : false;
		}
		return getPath(this.plugin.settings, key);
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		if (key.startsWith(VERSLINE_PREFIX)) {
			this.pendingVersline[key.slice(VERSLINE_PREFIX.length)] = (value as string) || null;
			this.flushVersline();
			return;
		}
		if (key.startsWith("modules.")) {
			const module = this.plugin.host.modules.find((m) => m.id === key.slice("modules.".length));
			if (module) await this.plugin.host.setEnabled(module, value === true);
			this.update();
			return;
		}
		setPath(this.plugin.settings as unknown as Record<string, unknown>, key, value);
		await this.plugin.saveSettings();
		if (key === "language") {
			setLanguage(resolveLanguage(value as LanguageSetting, getLanguage()));
			this.update();
		} else if (key === "verslinePath") {
			this.refreshBridge();
		} else if (key === "vaultLlm" || key === "outputPlacement") {
			this.update();
		}
	}

	private async writeVersline(): Promise<void> {
		const values = this.pendingVersline;
		this.pendingVersline = {};
		if (!Object.keys(values).length) return;
		try {
			await this.core.bridge.saveConfig(values);
			new Notice(t("settings.saved"), 1500);
		} catch (err) {
			new Notice(t("settings.saveFailed", { error: String((err as Error).message ?? err) }), 8000);
		}
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		applyDirection(this.containerEl);
		const s = this.plugin.settings;
		const bridge = this.core.bridge;
		const ready = () => bridge.state === "ready";
		// Versline's settings load in the background; re-render once they arrive.
		if (ready() && !bridge.config && !this.loadingConfig) {
			this.loadingConfig = true;
			void bridge.loadConfig().then((config) => {
				this.loadingConfig = false;
				if (config) this.update();
			});
		}
		const providers = bridge.config?.providers?.length ? bridge.config.providers : FALLBACK_PROVIDERS;
		const providerOptions = Object.fromEntries(providers.map((p) => [p, p]));
		const modelPlaceholder = (provider: string | undefined) =>
			(provider && bridge.config?.default_models?.[provider]) || "gemini-2.0-flash";

		const items: SettingDefinitionItem[] = [
			{
				type: "group",
				heading: t("settings.versline"),
				items: [
					{ name: t("settings.status"), render: (setting) => this.renderStatus(setting) },
					{ name: t("settings.updates"), render: (setting) => this.renderUpdates(setting) },
				],
			},
			{
				type: "group",
				heading: t("settings.ai"),
				visible: ready,
				items: [
					{
						name: t("settings.ai.where"),
						desc: t("settings.ai.whereDesc", { path: bridge.config?.path ?? "config.env" }),
					},
					{
						name: t("settings.provider"),
						control: { type: "dropdown", key: VERSLINE_PREFIX + KEY.provider, options: providerOptions },
					},
					{
						name: t("settings.model"),
						desc: t("settings.modelDesc"),
						control: {
							type: "text",
							key: VERSLINE_PREFIX + KEY.model,
							placeholder: modelPlaceholder(bridge.config?.values[KEY.provider]),
						},
					},
					{
						name: t("settings.apiKey"),
						desc: bridge.config?.secrets_set.includes(KEY.apiKey)
							? t("settings.apiKeySaved", { masked: bridge.config.values[KEY.apiKey] ?? "" })
							: t("settings.apiKeyMissing"),
						render: (setting) => this.renderApiKey(setting),
					},
					{
						name: t("settings.endpoint"),
						visible: () => (this.getControlValue(VERSLINE_PREFIX + KEY.provider) as string) === "OpenAICompatible",
						control: { type: "text", key: VERSLINE_PREFIX + KEY.endpoint, placeholder: "https://…/v1" },
					},
					{
						name: t("settings.proxy"),
						desc: t("settings.proxyDesc"),
						control: { type: "text", key: VERSLINE_PREFIX + KEY.proxy, placeholder: "socks5://127.0.0.1:10808" },
					},
				],
			},
			{
				type: "group",
				heading: t("settings.vault"),
				items: [
					{
						name: t("settings.vaultLlm"),
						desc: t("settings.vaultLlmDesc"),
						control: { type: "toggle", key: "vaultLlm" },
					},
					{
						name: t("settings.provider"),
						visible: () => s.vaultLlm,
						control: { type: "dropdown", key: "llmProvider", options: { "": t("settings.sameAsVersline"), ...providerOptions } },
					},
					{
						name: t("settings.model"),
						visible: () => s.vaultLlm,
						control: { type: "text", key: "llmModel", placeholder: modelPlaceholder(s.llmProvider) },
					},
					{
						name: t("settings.apiKey"),
						desc: t("settings.secretDesc"),
						visible: () => s.vaultLlm,
						control: { type: "secret", key: "llmApiKeySecret" },
					},
					{
						name: t("settings.endpoint"),
						visible: () => s.vaultLlm && s.llmProvider === "OpenAICompatible",
						control: { type: "text", key: "llmEndpoint", placeholder: "https://…/v1" },
					},
					{
						name: t("settings.proxy"),
						visible: () => s.vaultLlm,
						control: { type: "text", key: "llmProxy", placeholder: "socks5://127.0.0.1:10808" },
					},
				],
			},
			{
				type: "group",
				heading: t("settings.general"),
				items: [
					{
						name: t("settings.language"),
						desc: t("settings.languageDesc"),
						control: {
							type: "dropdown",
							key: "language",
							options: { auto: t("settings.languageAuto"), ...Object.fromEntries(LANGUAGES.map((l) => [l.id, l.name])) },
						},
					},
					{
						name: t("settings.placement"),
						desc: t("settings.placementDesc"),
						control: {
							type: "dropdown",
							key: "outputPlacement",
							options: { beside: t("settings.placementBeside"), folder: t("settings.placementFolder") },
						},
					},
					{
						name: t("settings.outputFolder"),
						visible: () => s.outputPlacement === "folder",
						control: { type: "folder", key: "outputFolder" },
					},
					{ name: t("settings.open"), control: { type: "toggle", key: "openResults" } },
					{ name: t("settings.stamp"), desc: t("settings.stampDesc"), control: { type: "toggle", key: "stampProperties" } },
					{ name: t("settings.notify"), control: { type: "toggle", key: "notifyOnFinish" } },
					{
						name: t("settings.concurrency"),
						desc: t("settings.concurrencyDesc"),
						control: { type: "slider", key: "concurrency", min: 1, max: 6, step: 1, displayFormat: (v) => formatNumber(v) },
					},
				],
			},
			{
				type: "group",
				heading: t("settings.modules"),
				items: this.plugin.host.modules.map((module) => ({
					name: t(module.name),
					desc: t(module.description),
					control: { type: "toggle" as const, key: `modules.${module.id}` },
				})),
			},
		];

		for (const module of this.plugin.host.modules) {
			if (!module.settings) continue;
			const ctx = this.plugin.host.settingsContext(module);
			items.push({
				type: "group",
				heading: t(module.name),
				visible: () => this.plugin.host.isEnabled(module),
				items: module.settings(ctx) as never,
			});
		}

		items.push({
			type: "group",
			heading: t("settings.advanced"),
			items: [
				{
					name: t("settings.verslinePath"),
					desc: t("settings.verslinePathDesc", { found: bridge.executable ?? t("settings.notFound") }),
					control: { type: "text", key: "verslinePath", placeholder: "versline" },
				},
				{
					name: t("settings.workdir"),
					desc: t("settings.workdirDesc"),
					control: { type: "text", key: "workdir", placeholder: "~/.cache/versline/bridge" },
				},
				{ name: t("settings.checkUpdates"), control: { type: "toggle", key: "checkUpdates" } },
				{ name: t("settings.debug"), control: { type: "toggle", key: "debugLogs" } },
			],
		});
		return items;
	}

	private renderStatus(setting: Setting): void {
		const bridge = this.core.bridge;
		const describe = () => {
			const state = bridge.state;
			setting.setDesc(
				state === "ready"
					? t("status.ready", { version: bridge.manifest?.versline ?? "" }) +
							` · ${t("settings.toolsCount", { count: bridge.manifest?.tools.length ?? 0 })}`
					: state === "checking"
						? t("status.checking")
						: state === "missing"
							? t("status.missing")
							: state === "outdated"
								? t("status.outdated")
								: t("status.error"),
			);
		};
		describe();
		setting.addButton((b) =>
			b.setButtonText(t("setup.checkAgain")).onClick(async () => {
				await bridge.refresh();
				this.update();
			}),
		);
		if (bridge.state !== "ready") {
			setting.addButton((b) => b.setButtonText(t("settings.howToInstall")).setCta().onClick(() => this.core.openSetup()));
		}
	}

	private renderUpdates(setting: Setting): void {
		setting.setDesc(t("settings.updatesDesc", { version: this.plugin.manifest.version }));
		setting.addButton((b) =>
			b.setButtonText(t("settings.updatePlugin")).onClick(() => void this.plugin.checkPluginUpdate(true)),
		);
		setting.addButton((b) =>
			b.setButtonText(t("settings.updateVersline")).onClick(() => void this.plugin.checkVerslineUpdate(true)),
		);
	}

	private renderApiKey(setting: Setting): void {
		let value = "";
		setting.addText((text) => {
			text.inputEl.type = "password";
			text.setPlaceholder(t("settings.apiKeyPlaceholder")).onChange((v) => (value = v.trim()));
		});
		setting.addButton((b) =>
			b
				.setButtonText(t("common.save"))
				.setCta()
				.onClick(async () => {
					if (!value) return;
					try {
						await this.core.bridge.saveConfig({ [KEY.apiKey]: value });
						new Notice(t("settings.saved"));
						this.update();
					} catch (err) {
						new Notice(t("settings.saveFailed", { error: String((err as Error).message ?? err) }), 8000);
					}
				}),
		);
		if (this.core.bridge.config?.secrets_set.includes(KEY.apiKey)) {
			setting.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip(t("common.remove"))
					.onClick(() => {
						new ConfirmationModal(this.app)
							.setTitle(t("settings.removeKeyTitle"))
							.setContent(t("settings.removeKeyBody"))
							.addButton((btn) =>
								btn
									.setButtonText(t("common.remove"))
									.setDestructive()
									.onClick(async () => {
										await this.core.bridge.saveConfig({ [KEY.apiKey]: null });
										this.update();
									}),
							)
							.addCancelButton(t("common.cancel"))
							.open();
					}),
			);
		}
	}
}
