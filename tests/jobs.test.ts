import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
	class Events {
		private handlers = new Map<string, ((...data: unknown[]) => void)[]>();
		on(name: string, cb: (...data: unknown[]) => void) {
			this.handlers.set(name, [...(this.handlers.get(name) ?? []), cb]);
			return {};
		}
		trigger(name: string, ...data: unknown[]) {
			for (const cb of this.handlers.get(name) ?? []) cb(...data);
		}
	}
	return { Events };
});

import type { RunHandle, RunOutcome } from "../src/bridge/client";
import type { ToolSpec } from "../src/bridge/protocol";
import type { BridgeService } from "../src/core/bridge-service";
import { JobManager } from "../src/jobs/job-manager";
import { parseJobs, serializeJob } from "../src/jobs/job-store";

function outcome(status: RunOutcome["status"], message = ""): RunOutcome {
	return {
		status,
		exitCode: status === "success" ? 0 : 1,
		data: {},
		artifacts: [],
		cost: { input_tokens: 10, output_tokens: 5, cached_tokens: 0, usd: 0.01, irt: null, error: null },
		error: status === "success" ? null : { code: "failed", message },
		stderr: "",
	};
}

/** A bridge whose runs finish when the test says so. */
function fakeBridge() {
	const runs: { tool: string; params: Record<string, unknown>; finish: (o: RunOutcome) => void; cancelled: boolean }[] = [];
	const bridge = {
		debug: false,
		run(tool: string, params: Record<string, unknown>): RunHandle {
			let finish!: (o: RunOutcome) => void;
			const done = new Promise<RunOutcome>((r) => (finish = r));
			const run = { tool, params, finish, cancelled: false };
			runs.push(run);
			return {
				done,
				answer: () => undefined,
				cancel: () => {
					run.cancelled = true;
					finish(outcome("cancelled"));
				},
			};
		},
	};
	return { bridge: bridge as unknown as BridgeService, runs };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("JobManager retry", () => {
	it("keeps the caller waiting through a failure and resumes it on a successful retry", async () => {
		const { bridge, runs } = fakeBridge();
		const jobs = new JobManager(bridge, () => 2, async () => null);
		const { job, done } = jobs.submit({ tool: "transcribe", title: "T", params: { inputs: ["/a.m4a"] } });
		let settled: RunOutcome | null = null;
		void done.then((o) => (settled = o));
		const detachedOnFinish: boolean[] = [];
		jobs.on("finished", () => detachedOnFinish.push(job.detached));

		runs[0]!.finish(outcome("error", "Connection error."));
		await tick();
		expect(job.status).toBe("error");
		expect(settled).toBeNull();

		expect(jobs.retry(job)).toBe(true);
		expect(runs).toHaveLength(2);
		expect(runs[1]!.params).toEqual({ inputs: ["/a.m4a"] });
		expect(job.attempts).toBe(2);
		expect(job.priorCost?.input_tokens).toBe(10);

		runs[1]!.finish(outcome("success"));
		await tick();
		expect(settled!.status).toBe("success");
		// The original caller handles the outputs, so no generic post-processing.
		expect(detachedOnFinish).toEqual([false, false]);
		expect(jobs.jobs).toEqual([job]);
	});

	it("non-retryable jobs resolve on failure", async () => {
		const { bridge, runs } = fakeBridge();
		const jobs = new JobManager(bridge, () => 1, async () => null);
		const { done } = jobs.submit({ tool: "x", title: "X", params: {}, retryable: false });
		runs[0]!.finish(outcome("error", "boom"));
		expect((await done).status).toBe("error");
	});

	it("clearing finished jobs releases waiting callers", async () => {
		const { bridge, runs } = fakeBridge();
		const jobs = new JobManager(bridge, () => 1, async () => null);
		const { done } = jobs.submit({ tool: "x", title: "X", params: {} });
		runs[0]!.finish(outcome("error", "boom"));
		await tick();
		jobs.clearFinished();
		expect((await done).status).toBe("error");
		expect(jobs.jobs).toHaveLength(0);
	});

	it("dispose marks running and queued jobs interrupted", async () => {
		const { bridge, runs } = fakeBridge();
		const jobs = new JobManager(bridge, () => 1, async () => null);
		const a = jobs.submit({ tool: "x", title: "A", params: {} });
		const b = jobs.submit({ tool: "x", title: "B", params: {} });
		jobs.dispose();
		expect(runs[0]!.cancelled).toBe(true);
		expect(runs).toHaveLength(1);
		expect(a.job.status).toBe("interrupted");
		expect(b.job.status).toBe("interrupted");
		await expect(a.done).resolves.toBeTruthy();
		await expect(b.done).resolves.toBeTruthy();
		await tick();
		expect(a.job.status).toBe("interrupted");
	});
});

describe("job store", () => {
	const spec = {
		name: "telegram.login",
		params: { type: "object", properties: { phone: { type: "string" }, password: { type: "string", "x-widget": "secret" } } },
	} as unknown as ToolSpec;

	it("restores unfinished jobs as interrupted and continues ids", async () => {
		const { bridge, runs } = fakeBridge();
		const first = new JobManager(bridge, () => 1, async () => null);
		const { job } = first.submit({ tool: "transcribe", title: "T", params: { inputs: ["/a.m4a"] }, sourcePath: "a.m4a" });
		const text = JSON.stringify({ version: 1, jobs: first.jobs.map((j) => serializeJob(j, undefined)) });

		const second = new JobManager(bridge, () => 2, async () => null);
		second.restore(parseJobs(text));
		const restored = second.jobs[0]!;
		expect(restored.status).toBe("interrupted");
		expect(restored.detached).toBe(true);
		expect(restored.sourcePath).toBe("a.m4a");
		expect(second.submit({ tool: "x", title: "X", params: {} }).job.id).toBe(job.id + 1);

		expect(second.retry(restored)).toBe(true);
		expect(runs.at(-1)!.params).toEqual({ inputs: ["/a.m4a"] });
	});

	it("does not write secrets and then refuses to retry without them", () => {
		const { bridge } = fakeBridge();
		const jobs = new JobManager(bridge, () => 1, async () => null);
		const { job } = jobs.submit({ tool: "telegram.login", title: "L", params: { phone: "1", password: "pw" } });
		const saved = serializeJob(job, spec);
		expect(saved.params).toEqual({ phone: "1" });
		expect(saved.retryable).toBe(false);
	});

	it("ignores a broken file", () => {
		expect(parseJobs("{not json")).toEqual([]);
		expect(parseJobs(JSON.stringify({ jobs: [{ nope: 1 }] }))).toEqual([]);
	});
});
