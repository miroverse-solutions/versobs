// Saves the job list to jobs.json in the plugin folder so it survives restarts.
// Unfinished jobs come back as "interrupted" and can be continued (Versline resumes from its cache).
import type { DataAdapter } from "obsidian";
import type { RunOutcome } from "../bridge/client";
import type { ToolSpec } from "../bridge/protocol";
import type { Job } from "./job-manager";

const FILE_VERSION = 1;
const SAVED_LOGS = 100;
const SAVE_DELAY_MS = 1500;

interface StoredFile {
	version: number;
	jobs: Job[];
}

/** A copy of the job safe to write to disk: no secrets, no stderr, trimmed logs. */
export function serializeJob(job: Job, spec: ToolSpec | undefined): Job {
	const params: Record<string, unknown> = {};
	let strippedSecret = false;
	for (const [key, value] of Object.entries(job.params)) {
		const widget = spec?.params.properties?.[key]?.["x-widget"];
		if (widget === "secret") {
			strippedSecret = true;
			continue;
		}
		params[key] = value;
	}
	const outcome: RunOutcome | null = job.outcome
		? { ...job.outcome, data: {}, stderr: "", artifacts: job.outcome.artifacts.slice(0, 50) }
		: null;
	return {
		...job,
		params,
		retryable: job.retryable && !strippedSecret,
		logs: job.logs.slice(-SAVED_LOGS),
		outcome,
		progress: null,
	};
}

function isStoredJob(value: unknown): value is Job {
	if (!value || typeof value !== "object") return false;
	const j = value as Partial<Job>;
	return typeof j.id === "number" && typeof j.tool === "string" && typeof j.title === "string" && typeof j.status === "string";
}

/** Parse jobs.json; tolerate older or partial entries. */
export function parseJobs(text: string): Job[] {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return [];
	}
	const list = (data as Partial<StoredFile> | null)?.jobs;
	if (!Array.isArray(list)) return [];
	return list.filter(isStoredJob).map((j) => ({
		...j,
		params: j.params && typeof j.params === "object" ? j.params : {},
		sourcePath: j.sourcePath ?? null,
		logs: Array.isArray(j.logs) ? j.logs : [],
		cost: j.cost ?? null,
		priorCost: j.priorCost ?? null,
		outcome: j.outcome ?? null,
		attempts: j.attempts ?? 1,
		retryable: j.retryable ?? true,
		detached: true,
		progress: null,
		queuedAt: j.queuedAt ?? 0,
		startedAt: j.startedAt ?? null,
		endedAt: j.endedAt ?? null,
	}));
}

export class JobStore {
	private timer: number | null = null;
	private writing: Promise<void> = Promise.resolve();

	constructor(
		private adapter: DataAdapter,
		private path: string,
		private snapshot: () => Job[],
		private spec: (tool: string) => ToolSpec | undefined,
	) {}

	async load(): Promise<Job[]> {
		try {
			if (!(await this.adapter.exists(this.path))) return [];
			return parseJobs(await this.adapter.read(this.path));
		} catch (err) {
			console.warn("[versobs] could not read saved jobs", err);
			return [];
		}
	}

	/** Save soon (job events arrive many times a second while running). */
	schedule(): void {
		if (this.timer !== null) return;
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.save();
		}, SAVE_DELAY_MS);
	}

	save(): Promise<void> {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		const file: StoredFile = {
			version: FILE_VERSION,
			jobs: this.snapshot().map((job) => serializeJob(job, this.spec(job.tool))),
		};
		const text = JSON.stringify(file);
		this.writing = this.writing
			.then(() => this.adapter.write(this.path, text))
			.catch((err) => console.warn("[versobs] could not save jobs", err));
		return this.writing;
	}
}
