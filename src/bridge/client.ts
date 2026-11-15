// Spawns `versline bridge ...` processes. One process per job: isolated, parallel, killable.
// No Obsidian imports (unit tests provide `window` for the timers).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
	type Artifact,
	type BridgeEvent,
	type CostInfo,
	isManifest,
	LineDecoder,
	type LlmOverrides,
	type Manifest,
	type RunRequest,
} from "./protocol";

export interface ClientOptions {
	executable: string;
	workdir?: string;
	/** Extra environment for the child (API key override etc.). Never put secrets on the command line. */
	env?: Record<string, string>;
	debug?: boolean;
}

export type RunStatus = "success" | "error" | "cancelled";

export interface RunOutcome {
	status: RunStatus;
	exitCode: number | null;
	data: Record<string, unknown>;
	artifacts: Artifact[];
	cost: CostInfo | null;
	/** code: one of ErrorCode, or a newer code from Versline. */
	error: { code: string; message: string } | null;
	stderr: string;
}

export interface RunHandle {
	/** Reply to a prompt event; null declines (cancels the job). */
	answer(promptId: string, value: string | null): void;
	cancel(): void;
	readonly done: Promise<RunOutcome>;
}

export class BridgeError extends Error {
	constructor(
		public code: string,
		message: string,
	) {
		super(message);
	}
}

const CANCEL_GRACE_MS = 3000;

const MAX_STDERR = 20000;

function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
	return { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", NO_COLOR: "1", ...(extra ?? {}) };
}

function spawnVersline(options: ClientOptions, args: string[]): ChildProcessWithoutNullStreams {
	return spawn(options.executable, args, {
		env: childEnv(options.env),
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
}

/** `versline bridge info`: the manifest of tools. Throws BridgeError("outdated") when versline has no bridge. */
export function fetchManifest(options: ClientOptions, timeoutMs = 60000): Promise<Manifest> {
	return new Promise((resolve, reject) => {
		let child: ChildProcessWithoutNullStreams;
		try {
			child = spawnVersline(options, ["bridge", "info"]);
		} catch (err) {
			reject(new BridgeError("spawn", String(err)));
			return;
		}
		let stdout = "";
		let stderr = "";
		const timer = window.setTimeout(() => {
			child.kill();
			reject(new BridgeError("spawn", "Timed out waiting for `versline bridge info`."));
		}, timeoutMs);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => (stdout += chunk));
		child.stderr.on("data", (chunk: string) => (stderr = (stderr + chunk).slice(-MAX_STDERR)));
		child.on("error", (err: NodeJS.ErrnoException) => {
			window.clearTimeout(timer);
			reject(new BridgeError(err.code === "ENOENT" ? "not_found" : "spawn", err.message));
		});
		child.on("close", (code) => {
			window.clearTimeout(timer);
			if (code !== 0) {
				const noBridge = /no such command|bridge/i.test(stderr) && /usage|command/i.test(stderr);
				reject(new BridgeError(noBridge ? "outdated" : "spawn", stderr.trim() || `exit ${code}`));
				return;
			}
			try {
				const parsed: unknown = JSON.parse(stdout);
				if (!isManifest(parsed)) throw new Error("not a manifest");
				resolve(parsed);
			} catch (err) {
				reject(new BridgeError("protocol", `Unexpected output from versline: ${String(err)}`));
			}
		});
		child.stdin.end();
	});
}

/** Start a tool run. Events arrive through onEvent; the returned handle resolves when the process exits. */
export function runTool(
	options: ClientOptions,
	tool: string,
	params: Record<string, unknown>,
	onEvent: (event: BridgeEvent) => void,
	llm?: LlmOverrides,
): RunHandle {
	const args = ["bridge", "run", tool];
	if (options.workdir) args.push("--workdir", options.workdir);
	if (options.debug) args.push("--debug");

	const outcome: RunOutcome = {
		status: "error",
		exitCode: null,
		data: {},
		artifacts: [],
		cost: null,
		error: null,
		stderr: "",
	};
	let child: ChildProcessWithoutNullStreams | null = null;
	let cancelRequested = false;
	let finished = false;

	const write = (message: Record<string, unknown>) => {
		if (child && !finished && child.stdin.writable) child.stdin.write(JSON.stringify(message) + "\n");
	};

	const done = new Promise<RunOutcome>((resolve) => {
		try {
			child = spawnVersline(options, args);
		} catch (err) {
			outcome.error = { code: "spawn", message: String(err) };
			resolve(outcome);
			return;
		}
		const decoder = new LineDecoder();
		const handle = (event: BridgeEvent) => {
			switch (event.type) {
				case "artifact":
					if (!outcome.artifacts.some((a) => a.path === event.path)) {
						outcome.artifacts.push({ path: event.path, kind: event.kind, exists: event.exists });
					}
					break;
				case "cost":
					outcome.cost = mergeCost(outcome.cost, event);
					break;
				case "result":
					outcome.status = "success";
					outcome.data = event.data ?? {};
					for (const a of event.artifacts ?? []) {
						if (!outcome.artifacts.some((b) => b.path === a.path)) outcome.artifacts.push(a);
					}
					break;
				case "error":
					outcome.status = event.code === "cancelled" ? "cancelled" : "error";
					outcome.error = { code: event.code, message: event.message };
					break;
			}
			try {
				onEvent(event);
			} catch (err) {
				console.error("[versobs] event handler failed", err);
			}
		};

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => decoder.push(chunk).forEach(handle));
		child.stderr.on("data", (chunk: string) => {
			outcome.stderr = (outcome.stderr + chunk).slice(-MAX_STDERR);
		});
		child.stdin.on("error", () => undefined); // EPIPE after the process exited
		child.on("error", (err: NodeJS.ErrnoException) => {
			outcome.error = { code: err.code === "ENOENT" ? "not_found" : "spawn", message: err.message };
		});
		child.on("close", (code) => {
			finished = true;
			decoder.flush().forEach(handle);
			outcome.exitCode = code;
			if (cancelRequested && outcome.status !== "success") {
				outcome.status = "cancelled";
				outcome.error ??= { code: "cancelled", message: "Cancelled" };
			} else if (outcome.status !== "success" && !outcome.error) {
				const noBridge = /no such command/i.test(outcome.stderr);
				outcome.error = {
					code: noBridge ? "outdated" : "failed",
					message: lastLine(outcome.stderr) || `versline exited with code ${code}`,
				};
			}
			resolve(outcome);
		});

		const request: RunRequest = { params };
		if (llm && Object.values(llm).some(Boolean)) request.llm = llm;
		child.stdin.write(JSON.stringify(request) + "\n");
	});

	return {
		done,
		answer(promptId, value) {
			write({ type: "answer", id: promptId, value });
		},
		cancel() {
			if (finished || !child) return;
			cancelRequested = true;
			write({ type: "cancel" });
			const target = child;
			window.setTimeout(() => {
				if (!finished) target.kill();
			}, CANCEL_GRACE_MS);
		},
	};
}

function mergeCost(previous: CostInfo | null, next: CostInfo): CostInfo {
	if (!previous) return { ...next };
	const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
	return {
		input_tokens: previous.input_tokens + next.input_tokens,
		output_tokens: previous.output_tokens + next.output_tokens,
		cached_tokens: previous.cached_tokens + next.cached_tokens,
		usd: add(previous.usd, next.usd),
		irt: add(previous.irt, next.irt),
		error: next.error ?? previous.error,
	};
}

function lastLine(text: string): string {
	const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
	return lines[lines.length - 1] ?? "";
}

/** Run a tool to completion without UI (settings reads/writes, status checks). Rejects on failure. */
export async function call(
	options: ClientOptions,
	tool: string,
	params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
	// No UI here: any prompt is declined (which cancels the job) instead of waiting forever.
	const handle: RunHandle = runTool(options, tool, params, (event) => {
		if (event.type === "prompt") handle.answer(event.id, null);
	});
	const outcome = await handle.done;
	if (outcome.status !== "success") {
		throw new BridgeError(outcome.error?.code ?? "failed", outcome.error?.message ?? "failed");
	}
	return outcome.data;
}
