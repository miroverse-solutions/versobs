// Queue of Versline jobs with a concurrency limit. Each job is one `versline bridge run` process.
// A failed job can be retried in place; Versline keeps per-chunk progress, so a retry resumes instead of starting over.
import { Events } from "obsidian";
import type { RunHandle, RunOutcome } from "../bridge/client";
import type { BridgeEvent, CostInfo } from "../bridge/protocol";
import type { BridgeService } from "../core/bridge-service";

/** "interrupted": Obsidian closed (or the plugin unloaded) while the job was running or queued. */
export type JobStatus = "queued" | "running" | "success" | "error" | "cancelled" | "interrupted";

export interface JobLog {
	level: string;
	message: string;
	time: number;
}

export interface Job {
	id: number;
	tool: string;
	title: string;
	params: Record<string, unknown>;
	/** Vault path of the note/file the job was started from (for post-processing a retried job). */
	sourcePath: string | null;
	status: JobStatus;
	progress: { current: number | null; total: number | null; label: string | null } | null;
	logs: JobLog[];
	/** Cost of the current attempt. */
	cost: CostInfo | null;
	/** Cost of earlier attempts of this job. */
	priorCost: CostInfo | null;
	outcome: RunOutcome | null;
	attempts: number;
	/** Can be run again from the jobs panel (false e.g. when secret params were not kept). */
	retryable: boolean;
	/** No caller is waiting for this job anymore (restored after a restart, or its caller moved on). */
	detached: boolean;
	queuedAt: number;
	startedAt: number | null;
	endedAt: number | null;
}

export interface PromptRequest {
	job: Job;
	message: string;
	secret: boolean;
	kind: string | null;
	defaultValue: string | null;
	choices: string[] | null;
}

export interface JobSpec {
	tool: string;
	title: string;
	params: Record<string, unknown>;
	sourcePath?: string | null;
	/** Keep the caller waiting through failures so a retry from the panel continues its flow (default true). */
	retryable?: boolean;
}

const MAX_LOGS = 500;
const MAX_HISTORY = 30;

export const isActive = (job: Job): boolean => job.status === "running" || job.status === "queued";
export const canRetry = (job: Job): boolean =>
	job.retryable && (job.status === "error" || job.status === "cancelled" || job.status === "interrupted");

export function addCost(a: CostInfo | null, b: CostInfo | null): CostInfo | null {
	if (!a) return b ? { ...b } : null;
	if (!b) return { ...a };
	const add = (x: number | null, y: number | null) => (x === null && y === null ? null : (x ?? 0) + (y ?? 0));
	return {
		input_tokens: a.input_tokens + b.input_tokens,
		output_tokens: a.output_tokens + b.output_tokens,
		cached_tokens: a.cached_tokens + b.cached_tokens,
		usd: add(a.usd, b.usd),
		irt: add(a.irt, b.irt),
		error: b.error ?? a.error,
	};
}

function stoppedOutcome(status: "cancelled" | "interrupted", message: string): RunOutcome {
	return {
		status: status === "cancelled" ? "cancelled" : "error",
		exitCode: null,
		data: {},
		artifacts: [],
		cost: null,
		error: { code: status, message },
		stderr: "",
	};
}

export class JobManager extends Events {
	jobs: Job[] = [];
	private nextId = 1;
	private handles = new Map<number, RunHandle>();
	private queue: Job[] = [];
	/** Callers awaiting a job's final outcome (see JobSpec.retryable). */
	private waiters = new Map<number, (o: RunOutcome) => void>();
	private stopping = false;

	constructor(
		private bridge: BridgeService,
		private concurrency: () => number,
		/** Ask the user (modal); resolve null to decline. */
		private ask: (request: PromptRequest) => Promise<string | null>,
	) {
		super();
	}

	get running(): Job[] {
		return this.jobs.filter((j) => j.status === "running");
	}

	get active(): Job[] {
		return this.jobs.filter(isActive);
	}

	submit(spec: JobSpec): { job: Job; done: Promise<RunOutcome> } {
		const job: Job = {
			id: this.nextId++,
			tool: spec.tool,
			title: spec.title,
			params: spec.params,
			sourcePath: spec.sourcePath ?? null,
			status: "queued",
			progress: null,
			logs: [],
			cost: null,
			priorCost: null,
			outcome: null,
			attempts: 1,
			retryable: spec.retryable ?? true,
			detached: false,
			queuedAt: Date.now(),
			startedAt: null,
			endedAt: null,
		};
		this.jobs.unshift(job);
		this.trimHistory();
		const done = new Promise<RunOutcome>((resolve) => this.waiters.set(job.id, resolve));
		this.queue.push(job);
		this.changed(job);
		this.pump();
		return { job, done };
	}

	/** Run a failed, cancelled or interrupted job again with the same parameters. */
	retry(job: Job): boolean {
		if (!canRetry(job) || !this.jobs.includes(job)) return false;
		job.priorCost = addCost(job.priorCost, job.cost);
		job.cost = null;
		job.attempts += 1;
		job.status = "queued";
		job.progress = null;
		job.outcome = null;
		job.queuedAt = Date.now();
		job.startedAt = null;
		job.endedAt = null;
		this.log(job, "info", `— retry #${job.attempts - 1} —`);
		this.queue.push(job);
		this.changed(job);
		this.pump();
		return true;
	}

	cancel(job: Job): void {
		if (job.status === "queued") {
			this.queue = this.queue.filter((j) => j !== job);
			this.end(job, stoppedOutcome("cancelled", "Cancelled"), "cancelled");
			return;
		}
		this.handles.get(job.id)?.cancel();
	}

	cancelAll(): void {
		for (const job of this.active) this.cancel(job);
	}

	/** Plugin unload: stop every process, mark unfinished jobs as interrupted, release waiting callers. */
	dispose(): void {
		this.stopping = true;
		for (const job of this.active) {
			this.handles.get(job.id)?.cancel();
			this.handles.delete(job.id);
			job.status = "interrupted";
			job.endedAt = Date.now();
			job.outcome = stoppedOutcome("interrupted", "Interrupted");
		}
		this.queue = [];
		for (const job of this.jobs) this.release(job);
	}

	clearFinished(): void {
		for (const job of this.jobs) if (!isActive(job)) this.release(job);
		this.jobs = this.jobs.filter(isActive);
		this.trigger("change", null);
	}

	/** Jobs saved before the last shutdown. Unfinished ones become "interrupted" and can be continued. */
	restore(saved: Job[]): void {
		const known = new Set(this.jobs.map((j) => j.id));
		for (const job of saved) {
			if (known.has(job.id)) continue;
			if (isActive(job)) {
				job.status = "interrupted";
				job.endedAt ??= Date.now();
				job.outcome = stoppedOutcome("interrupted", "Interrupted");
				job.progress = null;
			}
			job.detached = true;
			this.jobs.push(job);
			this.nextId = Math.max(this.nextId, job.id + 1);
		}
		this.jobs.sort((a, b) => b.queuedAt - a.queuedAt);
		this.trimHistory();
		this.trigger("change", null);
	}

	private trimHistory(): void {
		const finished = this.jobs.filter((j) => !isActive(j));
		if (finished.length <= MAX_HISTORY) return;
		const drop = new Set(finished.slice(MAX_HISTORY));
		for (const job of drop) this.release(job);
		this.jobs = this.jobs.filter((j) => !drop.has(j));
	}

	/** Resolve the caller still waiting on this job (if any) with its last outcome. */
	private release(job: Job): void {
		const resolve = this.waiters.get(job.id);
		if (!resolve) return;
		this.waiters.delete(job.id);
		job.detached = true;
		resolve(job.outcome ?? stoppedOutcome("interrupted", "Interrupted"));
	}

	private changed(job: Job): void {
		this.trigger("change", job);
	}

	private pump(): void {
		if (this.stopping) return;
		while (this.running.length < Math.max(1, this.concurrency()) && this.queue.length) {
			const job = this.queue.shift();
			if (job) this.start(job);
		}
	}

	private start(job: Job): void {
		job.status = "running";
		job.startedAt = Date.now();
		this.changed(job);

		const handle = this.bridge.run(job.tool, job.params, (event) => this.onEvent(job, event));
		this.handles.set(job.id, handle);
		void handle.done.then((outcome) => {
			if (this.handles.get(job.id) !== handle) return; // disposed meanwhile
			this.handles.delete(job.id);
			job.cost = outcome.cost;
			if (outcome.error && outcome.status === "error") {
				this.log(job, "error", outcome.error.message);
			}
			this.end(job, outcome, outcome.status);
			this.pump();
		});
	}

	private end(job: Job, outcome: RunOutcome, status: JobStatus): void {
		job.outcome = outcome;
		job.status = status;
		job.endedAt = Date.now();
		this.changed(job);
		this.trigger("finished", job);
		// A retryable failure keeps its caller waiting: a retry that succeeds continues the caller's flow.
		if (status !== "error" || !job.retryable) this.release(job);
	}

	private log(job: Job, level: string, message: string): void {
		job.logs.push({ level, message, time: Date.now() });
		if (job.logs.length > MAX_LOGS) job.logs.splice(0, job.logs.length - MAX_LOGS);
	}

	private onEvent(job: Job, event: BridgeEvent): void {
		switch (event.type) {
			case "progress":
				job.progress = { current: event.current, total: event.total, label: event.label };
				break;
			case "log":
				if (event.level !== "debug" || this.bridge.debug) this.log(job, event.level, event.message);
				break;
			case "cost":
				job.cost = event;
				break;
			case "prompt": {
				const handle = this.handles.get(job.id);
				void this.ask({
					job,
					message: event.message,
					secret: event.secret,
					kind: event.kind,
					defaultValue: event.default,
					choices: event.choices,
				}).then((value) => handle?.answer(event.id, value));
				break;
			}
			default:
				break;
		}
		this.changed(job);
	}
}
