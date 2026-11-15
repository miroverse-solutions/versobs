import { describe, expect, it } from "vitest";
import { candidatePaths } from "../src/bridge/locator";
import { LineDecoder, type ToolSpec } from "../src/bridge/protocol";
import {
	acceptsExtension,
	asText,
	coerce,
	defaultsOf,
	expandPattern,
	fieldsOf,
	missingRequired,
	primaryInput,
	primaryOutput,
	splitPath,
} from "../src/bridge/schema";
import { getPath, migrateSettings, setPath } from "../src/core/settings";
import { formatNumber, joinList, pick, resolveLanguage, setLanguage, t } from "../src/i18n";
import en from "../src/i18n/locales/en";
import fa from "../src/i18n/locales/fa";

const spec: ToolSpec = {
	name: "summarize.file",
	category: "text",
	title: { en: "Summarize file", fa: "خلاصه‌سازی فایل" },
	description: { en: "d", fa: "ت" },
	needs_llm: true,
	interactive: false,
	hidden: false,
	tags: [],
	params: {
		type: "object",
		required: ["inputs"],
		properties: {
			inputs: { type: "array", items: { type: "string" }, "x-widget": "files", "x-accept": [".md", ".pdf"] },
			output: { type: "string", nullable: true, default: null, "x-widget": "output-file", "x-output": "{dir}/{stem}_summary_{mode}.md" },
			mode: { type: "string", enum: ["outline", "detailed"], default: "detailed" },
			compression: { type: "integer", nullable: true, default: null },
			didactic: { type: "boolean", default: false, "x-advanced": true },
		},
	},
};

describe("protocol", () => {
	it("decodes NDJSON across chunk boundaries and skips noise", () => {
		const decoder = new LineDecoder();
		expect(decoder.push('{"type":"hello","versline":"1.6.0","protocol":1,"tool":"x"}\n{"type":"pro')).toHaveLength(1);
		const events = decoder.push('gress","current":1,"total":2,"label":"a"}\nnot json\n{"no_type":1}\n');
		expect(events).toEqual([{ type: "progress", current: 1, total: 2, label: "a" }]);
		expect(decoder.push('{"type":"result","data":{},"artifacts":[]}')).toHaveLength(0);
		expect(decoder.flush()).toHaveLength(1);
	});
});

describe("schema helpers", () => {
	it("lists fields with required/advanced flags and defaults", () => {
		const fields = fieldsOf(spec);
		expect(fields.map((f) => f.key)).toEqual(["inputs", "output", "mode", "compression", "didactic"]);
		expect(fields.find((f) => f.key === "inputs")?.required).toBe(true);
		expect(fields.find((f) => f.key === "didactic")?.advanced).toBe(true);
		expect(defaultsOf(spec)).toEqual({ mode: "detailed", didactic: false });
		expect(primaryInput(spec)?.key).toBe("inputs");
		expect(primaryOutput(spec)?.key).toBe("output");
	});

	it("expands output patterns from the first input", () => {
		expect(expandPattern("{dir}/{stem}_summary_{mode}.md", "Notes/Lecture 1.pdf", { mode: "outline" })).toBe(
			"Notes/Lecture 1_summary_outline.md",
		);
		expect(expandPattern("{dir}/{stem}.md", "talk.mp3")).toBe("talk.md");
		expect(expandPattern("{path}_pack", "Telegram/channel")).toBe("Telegram/channel_pack");
		expect(splitPath("a/b/c.tar.gz")).toMatchObject({ dir: "a/b", stem: "c.tar", ext: ".gz" });
	});

	it("coerces form strings and reports missing required fields", () => {
		const values = coerce(spec, { inputs: "a.md, b.md", compression: "30", output: "", mode: "outline", extra: 1 });
		expect(values).toEqual({ inputs: ["a.md", "b.md"], compression: 30, mode: "outline" });
		expect(missingRequired(spec, { inputs: [] })).toEqual(["inputs"]);
		expect(missingRequired(spec, values)).toEqual([]);
	});

	it("matches accepted extensions and stringifies values", () => {
		const inputs = spec.params.properties!.inputs!;
		expect(acceptsExtension(inputs, "PDF")).toBe(true);
		expect(acceptsExtension(inputs, ".docx")).toBe(false);
		expect(asText(null)).toBe("");
		expect(asText(["a"])).toBe('["a"]');
	});
});

describe("i18n", () => {
	it("resolves the language from Obsidian's", () => {
		expect(resolveLanguage("auto", "fa")).toBe("fa");
		expect(resolveLanguage("auto", "de")).toBe("en");
		expect(resolveLanguage("en", "fa")).toBe("en");
	});

	it("interpolates with localized numbers", () => {
		setLanguage("fa");
		expect(t("status.running", { count: 3 })).toBe("۳ کار ورس‌لاین در حال اجرا");
		expect(formatNumber(12)).toBe("۱۲");
		expect(joinList(["a", "b"])).toBe("a، b");
		expect(pick({ en: "Hi", fa: "سلام" })).toBe("سلام");
		setLanguage("en");
		expect(t("notice.done", { title: "X" })).toBe("Done: X");
		expect(pick({ en: "Hi", fa: "سلام" })).toBe("Hi");
	});

	it("has a Persian string for every key, with the same placeholders", () => {
		const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
		for (const key of Object.keys(en) as (keyof typeof en)[]) {
			expect(fa[key], key).toBeTruthy();
			expect(placeholders(fa[key]), key).toEqual(placeholders(en[key]));
		}
	});
});

describe("locator", () => {
	it("checks PATH, then the usual install folders", () => {
		const linux = candidatePaths({ platform: "linux", env: { PATH: "/usr/bin:/home/u/bin" }, home: "/home/u" });
		expect(linux[0]).toBe("/usr/bin/versline");
		expect(linux).toContain("/home/u/.local/bin/versline");
		expect(new Set(linux).size).toBe(linux.length);

		const win = candidatePaths({
			platform: "win32",
			env: { Path: "C:\\Windows", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" },
			home: "C:\\Users\\u",
		});
		expect(win).toContain("C:\\Users\\u\\AppData\\Local\\Versline\\versline.exe");
		expect(win).toContain("C:\\Users\\u\\.local\\bin\\versline.exe");
	});
});

describe("settings", () => {
	it("migrates stored data over defaults", () => {
		const settings = migrateSettings({ language: "fa", concurrency: 99, modules: { telegram: false } });
		expect(settings.language).toBe("fa");
		expect(settings.concurrency).toBe(8);
		expect(settings.modules).toEqual({ telegram: false });
		expect(settings.outputPlacement).toBe("beside");
		expect(migrateSettings(null).version).toBe(1);
	});

	it("reads and writes dotted keys", () => {
		const root: Record<string, unknown> = {};
		setPath(root, "moduleSettings.telegram.folder", "TG");
		expect(getPath(root, "moduleSettings.telegram.folder")).toBe("TG");
		expect(getPath(root, "moduleSettings.nope.x")).toBeUndefined();
	});
});
