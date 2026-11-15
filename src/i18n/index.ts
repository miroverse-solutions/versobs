// Tiny typed i18n. English is the source of keys; every other locale must define all of them (checked by tsc).
// No Obsidian imports, so it can be unit-tested; the plugin passes Obsidian's getLanguage() in.
import en from "./locales/en";
import fa from "./locales/fa";

export type MessageKey = keyof typeof en;
export type Locale = Record<MessageKey, string>;
export type Lang = "en" | "fa";
export type LanguageSetting = "auto" | Lang;

const LOCALES: Record<Lang, Locale> = { en, fa };
const RTL: ReadonlySet<Lang> = new Set<Lang>(["fa"]);

let current: Lang = "en";

export const LANGUAGES: { id: Lang; name: string }[] = [
	{ id: "en", name: "English" },
	{ id: "fa", name: "فارسی" },
];

export function resolveLanguage(setting: LanguageSetting, appLanguage: string | undefined): Lang {
	if (setting !== "auto") return setting;
	const base = (appLanguage ?? "en").toLowerCase().split(/[-_]/)[0] as Lang;
	return base in LOCALES ? base : "en";
}

export function setLanguage(lang: Lang): void {
	current = lang;
}

export function getLang(): Lang {
	return current;
}

export function isRtl(lang: Lang = current): boolean {
	return RTL.has(lang);
}

/** Translate a key; `{name}` placeholders are replaced from vars (numbers are localized). */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
	const template = LOCALES[current][key] ?? en[key] ?? key;
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (match, name: string) => {
		const value = vars[name];
		if (value === undefined) return match;
		return typeof value === "number" ? formatNumber(value) : value;
	});
}

/** Pick the current language from a bilingual manifest text ({en, fa, ...}). */
export function pick(text: Partial<Record<string, string>> | undefined, fallback = ""): string {
	if (!text) return fallback;
	return text[current] || text.en || Object.values(text).find(Boolean) || fallback;
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
	return new Intl.NumberFormat(current === "fa" ? "fa-IR" : "en-US", options).format(value);
}

export function joinList(items: string[]): string {
	return items.join(current === "fa" ? "، " : ", ");
}

export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (n: number) => formatNumber(n, { minimumIntegerDigits: 2 });
	return h ? `${formatNumber(h)}:${pad(m)}:${pad(s)}` : `${formatNumber(m)}:${pad(s)}`;
}

/** Apply direction to an element we own (modals, views). */
export function applyDirection(el: HTMLElement): void {
	el.setAttr?.("dir", isRtl() ? "rtl" : "ltr");
	el.toggleClass?.("versobs-rtl", isRtl());
}
