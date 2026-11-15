// Queue of Versline jobs with a concurrency limit. Each job is one `versline bridge run` process.
import { Events } from "obsidian";
import type { RunHandle, RunOutcome } from "../bridge/client";
import type { BridgeEvent, CostInfo } from "../bridge/protocol";
import type { BridgeService } from "../core/bridge-service";

export type JobStatus = "queued" | "running" | "success" | "error" | "cancelled";

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
	status: JobStatus;
	progress: { current: number | null; total: number | null; label: string | null } | null;
	logs: JobLog[];
	cost: CostInfo | null;
	outcome: RunOutcome | null;
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
}

const MAX_LOGS = 500;
const MAX_HISTORY = 30;

export class JobManager extends Events {
	jobs: Job[] = [];
	private nextId = 1;
	private handles = new Map<number, RunHandle>();
	private waiting: { job: Job; resolve: (o: RunOutcome) => void }[] = [];

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
		return this.jobs.filter((j) => j.status === "running" || j.status === "queued");
	}

	submit(spec: JobSpec): { job: Job; done: Promise<RunOutcome> } {
		const job: Job = {
			id: this.nextId++,
			tool: spec.tool,
			title: spec.title,
			params: spec.params,
			status: "queued",
			progress: null,
			logs: [],
			cost: null,
			outcome: null,
			queuedAt: Date.now(),
			startedAt: null,
			endedAt: null,
		};
		this.jobs.unshift(job);
		this.trimHistory();
		const done = new Promise<RunOutcome>((resolve) => this.waiting.push({ job, resolve }));
		this.changed(job);
		this.pump();
		return { job, done };
	}

	cancel(job: Job): void {
		if (job.status === "queued") {
			const index = this.waiting.findIndex((w) => w.job === job);
			const entry = index >= 0 ? this.waiting.splice(index, 1)[0] : undefined;
			job.status = "cancelled";
			job.endedAt = Date.now();
			const outcome: RunOutcome = {
				status: "cancelled",
				exitCode: null,
				data: {},
				artifacts: [],
				cost: null,
				error: { code: "cancelled", message: "Cancelled" },
				stderr: "",
			};
			job.outcome = outcome;
			entry?.resolve(outcome);
			this.changed(job);
			return;
		}
		this.handles.get(job.id)?.cancel();
	}

	cancelAll(): void {
		for (const job of this.active) this.cancel(job);
	}

	clearFinished(): void {
		this.jobs = this.jobs.filter((j) => j.status === "running" || j.status === "queued");
		this.trigger("change", null);
	}

	private trimHistory(): void {
		const finished = this.jobs.filter((j) => j.status !== "running" && j.status !== "queued");
		if (finished.length <= MAX_HISTORY) return;
		const drop = new Set(finished.slice(MAX_HISTORY));
		this.jobs = this.jobs.filter((j) => !drop.has(j));
	}

	private changed(job: Job): void {
		this.trigger("change", job);
	}

	private pump(): void {
		while (this.running.length < Math.max(1, this.concurrency()) && this.waiting.length) {
			const entry = this.waiting.shift();
			if (entry) this.start(entry.job, entry.resolve);
		}
	}

	private start(job: Job, resolve: (o: RunOutcome) => void): void {
		job.status = "running";
		job.startedAt = Date.now();
		this.changed(job);

		const handle = this.bridge.run(job.tool, job.params, (event) => this.onEvent(job, event));
		this.handles.set(job.id, handle);
		void handle.done.then((outcome) => {
			this.handles.delete(job.id);
			job.outcome = outcome;
			job.cost = outcome.cost;
			job.status = outcome.status;
			job.endedAt = Date.now();
			if (outcome.error && outcome.status === "error") {
				this.log(job, "error", outcome.error.message);
			}
			this.changed(job);
			this.trigger("finished", job);
			resolve(outcome);
			this.pump();
		});
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
