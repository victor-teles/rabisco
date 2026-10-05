/**
 * Shared plumbing for CLI providers (Claude Code, Codex, Gemini CLI):
 * finding the binary, spawning it, reading JSON lines from stdout, killing it
 * on abort, and turning stderr into provider error codes.
 */

import { accessSync, constants, statSync } from "fs";
import { homedir } from "os";
import { delimiter, dirname, join } from "path";
import type { GenerationEvent, ProviderErrorCode, ProviderHealth } from "../../shared/ai/contract";
import { PROVIDER_TYPES, type ProviderType } from "../../shared/ai/settings";
import type { Json } from "../../shared/json";
import { parseJson } from "../json";

// ---------------------------------------------------------------- spawn

export type SpawnOptions = {
	cwd?: string;
	env?: Record<string, string | undefined>;
	/** Written to stdin, which is then closed. stdin is empty when omitted. */
	stdin?: string;
};

export type SpawnedProcess = {
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	/** Resolves with the exit code once the process has exited */
	exited: Promise<number>;
	kill(signal?: NodeJS.Signals | number): void;
};

/** Starts a process. Throws when the binary can't be executed. Injectable for tests. */
export type SpawnFn = (cmd: string[], options: SpawnOptions) => SpawnedProcess;

export const bunSpawn: SpawnFn = (cmd, options) => {
	const proc = Bun.spawn(cmd, {
		cwd: options.cwd,
		env: options.env,
		stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
		stdout: "pipe",
		stderr: "pipe",
	});

	return { stdout: proc.stdout, stderr: proc.stderr, exited: proc.exited, kill: (signal) => proc.kill(signal) };
};

// ---------------------------------------------------------------- binaries

/** Where CLIs usually live. GUI apps on macOS don't inherit the shell PATH. */
export function commonBinDirs(home = homedir()) {
	return [
		join(home, ".local/bin"),
		join(home, ".claude/local"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
		join(home, ".bun/bin"),
		join(home, ".npm-global/bin"),
		join(home, ".volta/bin"),
		join(home, ".cargo/bin"),
		"/usr/bin",
	];
}

const isExecutable = (path: string) => {
	try {
		if (!statSync(path).isFile()) return false;
		accessSync(path, constants.X_OK);

		return true;
	} catch {
		return false;
	}
};

/**
 * Finds a CLI: the configured `binPath` first, then PATH, then common install
 * locations. Returns null when it isn't installed (or `binPath` is wrong).
 */
export function resolveBinary(
	name: string,
	binPath?: string,
	options: { path?: string; dirs?: string[] } = {},
): string | null {
	if (binPath) return isExecutable(binPath) ? binPath : null;

	const dirs = [
		...(options.path ?? process.env.PATH ?? "").split(delimiter).filter(Boolean),
		...(options.dirs ?? commonBinDirs()),
	];

	for (const dir of dirs) {
		const candidate = join(dir, name);

		if (isExecutable(candidate)) return candidate;
	}

	return null;
}

/** process.env with PATH extended by the binary's folder and common locations, so CLIs find node and friends. */
export function cliEnv(binary: string, extra: Record<string, string | undefined> = {}) {
	const path = [dirname(binary), ...(process.env.PATH ?? "").split(delimiter), ...commonBinDirs()].filter(Boolean);

	return { ...process.env, PATH: [...new Set(path)].join(delimiter), ...extra };
}

// ---------------------------------------------------------------- errors

export const CLI_BINARIES: Partial<Record<ProviderType, string>> = {
	"claude-code": "claude",
	codex: "codex",
	"gemini-cli": "gemini",
};

const LOGIN_FIX: Partial<Record<ProviderType, string>> = {
	"claude-code": "Run `claude` in a terminal and log in.",
	codex: "Run `codex login` in a terminal.",
	"gemini-cli": "Run `gemini` in a terminal and sign in.",
	"claude-agent-sdk": "Add an Anthropic API key in Settings.",
};

const labelOf = (type: ProviderType) => PROVIDER_TYPES.find((info) => info.type === type)?.label ?? type;

/** A provider failure, before it becomes a `health` result or an `error` event. */
export type ProviderFailure = {
	code: ProviderErrorCode;
	message: string;
	retryable: boolean;
	fix?: string;
};

export function notInstalled(type: ProviderType): ProviderFailure {
	const help = PROVIDER_TYPES.find((info) => info.type === type)?.helpUrl;
	const label = labelOf(type);

	return {
		code: "not_installed",
		message: `${label} isn't installed, or Rabisco can't find it.`,
		retryable: false,
		fix: `Install ${label}${help ? ` (${help})` : ""}, or set its path in Settings.`,
	};
}

export function notAuthenticated(type: ProviderType, message?: string): ProviderFailure {
	return {
		code: "not_authenticated",
		message: message || `${labelOf(type)} isn't logged in.`,
		retryable: false,
		fix: LOGIN_FIX[type],
	};
}

/** Maps CLI output (stderr, an error event, a failed result) to an error code. */
export function classifyFailure(type: ProviderType, text: string): ProviderFailure {
	const message = text.trim().split("\n").slice(-6).join("\n").slice(0, 600) || `${labelOf(type)} failed.`;

	if (/rate.?limit|too many requests|\b429\b|usage limit|quota|overloaded/i.test(text))
		return { code: "rate_limited", message, retryable: true };

	if (/context (length|window)|prompt is too long|too many tokens|maximum context/i.test(text))
		return { code: "context_too_large", message, retryable: false };

	if (/not logged in|log ?in|authenticat|unauthori[sz]ed|api[ _-]?key|\b401\b|credentials|auth method/i.test(text))
		return notAuthenticated(type, message);

	if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|fetch failed|socket hang up/i.test(text))
		return { code: "network", message, retryable: true };

	return { code: "unknown", message, retryable: false };
}

export const failureEvent = (failure: ProviderFailure): GenerationEvent => ({
	type: "error",
	code: failure.code,
	message: failure.message,
	retryable: failure.retryable,
	fix: failure.fix,
});

export const failureHealth = (failure: ProviderFailure): ProviderHealth => ({
	ok: false,
	code: failure.code,
	message: failure.message,
	fix: failure.fix,
});

export const abortedEvent = (): GenerationEvent => ({
	type: "error",
	code: "aborted",
	message: "Generation stopped.",
	retryable: false,
});

// ---------------------------------------------------------------- reading output

/** Resolves when `signal` aborts; never rejects. */
export function whenAborted(signal: AbortSignal): Promise<"aborted"> {
	if (signal.aborted) return Promise.resolve("aborted");

	return new Promise((resolve) => signal.addEventListener("abort", () => resolve("aborted"), { once: true }));
}

/** Splits a byte stream into lines. Stops (and cancels the stream) as soon as `signal` aborts. */
export async function* readLines(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	const aborted = signal ? whenAborted(signal) : null;
	let buffer = "";

	try {
		while (true) {
			const next = aborted ? await Promise.race([reader.read(), aborted]) : await reader.read();

			if (next === "aborted") return;

			if (next.done) break;
			buffer += decoder.decode(next.value, { stream: true });
			let at: number;

			while ((at = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, at).replace(/\r$/, "");
				buffer = buffer.slice(at + 1);
				yield line;
			}
		}

		buffer += decoder.decode();

		if (buffer) yield buffer;
	} finally {
		reader.cancel().catch(() => {});
	}
}

/** Reads a whole stream as text, giving up quietly on errors. */
export async function readAll(stream: ReadableStream<Uint8Array>) {
	try {
		return await new Response(stream).text();
	} catch {
		return "";
	}
}

/** SIGTERM now, SIGKILL if the process is still alive after `graceMs`. */
export function terminate(proc: SpawnedProcess, graceMs = 2000) {
	let exited = false;
	proc.exited.then(
		() => (exited = true),
		() => (exited = true),
	);

	try {
		proc.kill("SIGTERM");
	} catch {}

	const timer = setTimeout(() => {
		if (exited) return;

		try {
			proc.kill("SIGKILL");
		} catch {}
	}, graceMs);

	timer.unref?.();
}

/** Runs a short command (e.g. `--version`) and collects its output. */
export async function runCommand(spawn: SpawnFn, cmd: string[], options: SpawnOptions & { timeoutMs?: number } = {}) {
	const proc = spawn(cmd, options);
	const timer = setTimeout(() => terminate(proc, 500), options.timeoutMs ?? 15_000);

	try {
		const [stdout, stderr, code] = await Promise.all([readAll(proc.stdout), readAll(proc.stderr), proc.exited]);

		return { code, stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}

/** Pulls the first version-looking token out of `--version` output. */
export const parseVersion = (text: string) =>
	text.match(/\d+\.\d+\.\d+[\w.-]*/)?.[0] ?? (text.trim().split("\n")[0] || undefined);

/** `--version` health check shared by CLI providers. */
export async function versionHealth(
	type: ProviderType,
	spawn: SpawnFn,
	binary: string | null,
): Promise<ProviderHealth & { binary?: string }> {
	if (!binary) return failureHealth(notInstalled(type));

	try {
		const result = await runCommand(spawn, [binary, "--version"], { env: cliEnv(binary), timeoutMs: 10_000 });

		if (result.code !== 0) return failureHealth(classifyFailure(type, result.stderr || result.stdout));

		return { ok: true, version: parseVersion(result.stdout), binary };
	} catch {
		return failureHealth(notInstalled(type));
	}
}

// ---------------------------------------------------------------- agent runs

/** Turns one parsed JSON line into events. May return a `done` or `error`, which ends the run. */
export type LineMapper = (line: Json) => GenerationEvent[];

export type CliAgentRun = {
	type: ProviderType;
	spawn: SpawnFn;
	cmd: string[];
	cwd: string;
	env?: Record<string, string | undefined>;
	stdin?: string;
	map: LineMapper;
};

/**
 * Spawns an agent CLI and maps its JSON-lines stdout to events, ending with
 * exactly one `done` or `error`. Kills the process on abort, and when the
 * consumer stops early.
 */
export async function* runCliAgent(run: CliAgentRun, signal: AbortSignal): AsyncGenerator<GenerationEvent> {
	if (signal.aborted) {
		yield abortedEvent();

		return;
	}

	let proc: SpawnedProcess;

	try {
		proc = run.spawn(run.cmd, { cwd: run.cwd, env: run.env, stdin: run.stdin });
	} catch (error) {
		const code = error instanceof Error && "code" in error ? error.code : undefined;
		yield failureEvent(
			code === "ENOENT" || code === "EACCES" ? notInstalled(run.type) : classifyFailure(run.type, String(error)),
		);

		return;
	}

	let exited = false;
	const exitCode = proc.exited.then((code) => ((exited = true), code));
	const stderr = readAll(proc.stderr);
	const onAbort = () => terminate(proc);
	signal.addEventListener("abort", onAbort, { once: true });
	const noise: string[] = [];

	try {
		for await (const line of readLines(proc.stdout, signal)) {
			if (!line.trim()) continue;
			let parsed: Json;

			try {
				parsed = parseJson(line);
			} catch {
				noise.push(line);
				continue;
			}

			for (const event of run.map(parsed)) {
				yield event;

				if (event.type === "done" || event.type === "error") return;
			}
		}

		if (signal.aborted) {
			yield abortedEvent();

			return;
		}

		const code = await exitCode;

		if (signal.aborted) {
			yield abortedEvent();

			return;
		}

		if (code === 0) {
			yield { type: "done" };

			return;
		}

		const text = [await stderr, ...noise].join("\n").trim();
		yield failureEvent(classifyFailure(run.type, text || `exited with code ${code}`));
	} finally {
		signal.removeEventListener("abort", onAbort);

		if (!exited) {
			// Give a finished agent a moment to exit on its own before killing it
			const settled = await Promise.race([
				exitCode.then(() => true),
				new Promise((r) => setTimeout(() => r(false), signal.aborted ? 0 : 1500)),
			]);

			if (!settled) terminate(proc);
		}
	}
}

// ---------------------------------------------------------------- shared mapping helpers

/** Joins assistant text from separate blocks or turns with a blank line. */
export class MessageText {
	private started = false;
	private pendingBreak = false;

	/** The next text starts a new paragraph (after a tool call, or a new block). */
	break() {
		if (this.started) this.pendingBreak = true;
	}

	delta(text: string): GenerationEvent[] {
		if (!text) return [];
		const out = this.pendingBreak ? `\n\n${text.replace(/^\n+/, "")}` : text;
		this.started = true;
		this.pendingBreak = false;

		return [{ type: "message.delta", text: out }];
	}
}

/** `/tmp/rabisco-staging-x/screens/home.tsx` → `screens/home.tsx` */
export function stagingRelative(dir: string, path: string | undefined) {
	if (!path) return undefined;
	const clean = path.replace(/\\/g, "/");

	for (const root of [dir, `/private${dir}`, dir.replace(/^\/private/, "")]) {
		if (clean.startsWith(`${root}/`)) return clean.slice(root.length + 1);
	}

	return clean.replace(/^\.\//, "");
}

/** A short status for a file tool call, e.g. "Writing screens/home.tsx". */
export function toolStatus(
	verb: "write" | "edit" | "read" | "search" | "list" | "run" | "other",
	path?: string,
	tool?: string,
): GenerationEvent {
	const labels = {
		write: "Writing",
		edit: "Editing",
		read: "Reading",
		search: "Searching files",
		list: "Listing files",
		run: "Running a command",
		other: tool ? `Using ${tool}` : "Working",
	};

	const label = labels[verb];

	if (path && (verb === "write" || verb === "edit" || verb === "read"))
		return { type: "status", label: `${label} ${path}` };

	return path ? { type: "status", label, detail: path } : { type: "status", label };
}
