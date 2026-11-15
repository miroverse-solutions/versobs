// Runs the real `versline bridge` (no AI calls). Skipped when Versline is not installed.
// Point VERSLINE_BIN at a specific executable, e.g. ../versline/.venv/bin/versline.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ClientOptions, call, fetchManifest, runTool } from "../src/bridge/client";
import { locateVersline } from "../src/bridge/locator";
import type { BridgeEvent } from "../src/bridge/protocol";

const found = process.env.VERSLINE_BIN || locateVersline();
// An older Versline without the `bridge` command cannot run these tests: skip instead of failing.
const executable = found && spawnSync(found, ["bridge", "--help"], { stdio: "ignore" }).status === 0 ? found : undefined;
const scratch = mkdtempSync(join(tmpdir(), "versobs-test-"));
const options: ClientOptions = {
	executable: executable ?? "versline",
	workdir: join(scratch, "work"),
	// Never touch the developer's real Versline settings.
	env: { VERSLINE_CONFIG_DIR: join(scratch, "config") },
};

describe.skipIf(!executable)("versline bridge (real process)", () => {
	it("returns a manifest with bilingual tools", async () => {
		const manifest = await fetchManifest(options);
		expect(manifest.protocol).toBe(1);
		const summarize = manifest.tools.find((t) => t.name === "summarize.file");
		expect(summarize?.title.fa).toBeTruthy();
		expect(summarize?.params.properties?.inputs?.["x-widget"]).toBe("files");
	});

	it("writes and reads settings through config.set/get", async () => {
		const data = await call(options, "config.set", { values: { VERSLINE_LLM_PROVIDER: "OpenAI", VERSLINE_LLM_API_KEY: "sk-test-123456" } });
		const values = data.values as Record<string, string>;
		expect(values.VERSLINE_LLM_PROVIDER).toBe("OpenAI");
		expect(values.VERSLINE_LLM_API_KEY).not.toBe("sk-test-123456");
	});

	it("runs a tool and reports progress, artifacts and the result", async () => {
		const source = join(scratch, "folder");
		mkdirSync(source, { recursive: true });
		writeFileSync(join(source, "a.txt"), "same content");
		writeFileSync(join(source, "b.txt"), "same content");
		const events: BridgeEvent[] = [];
		const outcome = await runTool(
			options,
			"organize.report",
			{ sources: [source], copy_to: join(scratch, "reports") },
			(e) => events.push(e),
		).done;
		expect(outcome.status, JSON.stringify(outcome.error)).toBe("success");
		expect(events[0]?.type).toBe("hello");
		expect(events.some((e) => e.type === "progress")).toBe(true);
		expect(outcome.artifacts.some((a) => a.path.endsWith(".md"))).toBe(true);
	});

	it("reports invalid parameters", async () => {
		const outcome = await runTool(options, "summarize.file", { inputs: [] }, () => undefined).done;
		expect(outcome.status).toBe("error");
		expect(outcome.error?.code).toBe("invalid_params");
	});

	it("asks through prompt events and can be cancelled", async () => {
		const prompts: BridgeEvent[] = [];
		const handle = runTool(options, "telegram.login", {}, (e) => {
			if (e.type === "prompt") {
				prompts.push(e);
				handle.cancel();
			}
		});
		const outcome = await handle.done;
		expect(prompts[0]).toMatchObject({ type: "prompt", kind: "api_id" });
		expect(outcome.status).toBe("cancelled");
	});

	it("declines prompts in background calls instead of hanging", async () => {
		await expect(call(options, "telegram.login")).rejects.toMatchObject({ code: "cancelled" });
	});

	it("reports a missing executable", async () => {
		const outcome = await runTool({ executable: join(scratch, "nope") }, "system.info", {}, () => undefined).done;
		expect(outcome.error?.code).toBe("not_found");
	});
});
