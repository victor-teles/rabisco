// Agents never touch the project: they run in a temp copy that is diffed afterwards (decision 0003).

import { watch, type FSWatcher } from "fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join, resolve, sep } from "path";
import type { FileKind, GenerationEvent, GenerationRequest, Usage } from "../../shared/ai/contract";
import { contextBody } from "../../shared/context/body";
import { screenNameFromPath } from "../../shared/project";
import { abortedEvent } from "./cli";
import { systemPrompt } from "./prompt";
import { contextTargetOf } from "./run";

/** Files Rabisco writes for the agent; never reported as changes. */
export const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md", "GEMINI.md"] as const;

const CONTEXT_FILES = ["PRODUCT.md", "DESIGN.md"] as const;

const RESERVED = new Set<string>([...INSTRUCTION_FILES, ...CONTEXT_FILES]);

/** Naming rules are checked later by validation, which can ask for a repair. */
const WRITABLE = /^(screens|components)\/[^/]+\.tsx$/;

export const isWritablePath = (path: string) => WRITABLE.test(path);

const kindOf = (path: string): FileKind =>
	path.startsWith("screens/") ? "screen" : path.startsWith("components/") ? "component" : "context";

function writableFor(request: GenerationRequest) {
	const target = contextTargetOf(request);

	return (path: string) => isWritablePath(path) || path === target;
}

/** File events from the agent are ignored; the staging watcher produces them. */
export type AgentRunner = (dir: string, signal: AbortSignal) => AsyncIterable<GenerationEvent>;

export type StagingOptions = {
	root?: string;
	debounceMs?: number;
	pollMs?: number;
};

export async function createStagingDir(request: GenerationRequest, root = tmpdir()): Promise<string> {
	const dir = await mkdtemp(join(root, "rabisco-staging-"));
	const contextTarget = contextTargetOf(request);

	try {
		await mkdir(join(dir, "screens"), { recursive: true });
		await mkdir(join(dir, "components"), { recursive: true });

		for (const file of request.files) {
			const target = resolve(dir, file.path);

			if (!target.startsWith(dir + sep) || (RESERVED.has(file.path) && file.path !== contextTarget)) continue;
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, file.content);
		}

		const context = { "PRODUCT.md": request.context.product, "DESIGN.md": request.context.design };

		for (const [name, content] of Object.entries(context)) {
			if (name !== contextTarget && content && contextBody(content)) await writeFile(join(dir, name), content);
		}

		const instructions = systemPrompt(request, "agent");

		for (const name of INSTRUCTION_FILES) await writeFile(join(dir, name), instructions);

		return dir;
	} catch (error) {
		await rm(dir, { recursive: true, force: true });
		throw error;
	}
}

async function listFiles(dir: string, sub = ""): Promise<string[]> {
	let entries;

	try {
		entries = await readdir(join(dir, sub), { withFileTypes: true });
	} catch {
		return [];
	}

	const out: string[] = [];

	for (const entry of entries) {
		const path = sub ? `${sub}/${entry.name}` : entry.name;

		if (entry.isDirectory()) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			out.push(...(await listFiles(dir, path)));
		} else if (entry.isFile()) out.push(path);
	}

	return out;
}

const readIfExists = (path: string) => readFile(path, "utf8").catch(() => null);

class Queue<T> {
	private items: T[] = [];
	private waiting: ((item: T) => void) | null = null;

	push(item: T) {
		const waiting = this.waiting;

		if (waiting) {
			this.waiting = null;
			waiting(item);
		} else this.items.push(item);
	}

	next(): Promise<T> {
		if (this.items.length) return Promise.resolve(this.items.shift()!);

		return new Promise((resolve) => (this.waiting = resolve));
	}

	drain(): T[] {
		return this.items.splice(0);
	}
}

type Item =
	| { kind: "event"; event: GenerationEvent }
	| { kind: "agent-end"; usage?: Usage; error?: GenerationEvent }
	| { kind: "aborted" };

/** Ends with exactly one `done` or `error`; no file events follow an agent error. */
export async function* runInStaging(
	request: GenerationRequest,
	signal: AbortSignal,
	runAgent: AgentRunner,
	options: StagingOptions = {},
): AsyncGenerator<GenerationEvent> {
	if (signal.aborted) {
		yield abortedEvent();

		return;
	}

	let dir: string;

	try {
		dir = await createStagingDir(request, options.root);
	} catch (error) {
		yield {
			type: "error",
			code: "unknown",
			message: `Couldn't prepare a working folder: ${error instanceof Error ? error.message : String(error)}`,
			retryable: true,
		};

		return;
	}

	const writable = writableFor(request);
	const original = new Map(request.files.filter((f) => writable(f.path)).map((f) => [f.path, f.content]));
	const emitted = new Map<string, string>();
	const ignored = new Set<string>();
	const queue = new Queue<Item>();
	const agentAbort = new AbortController();

	const forwardAbort = () => {
		agentAbort.abort(signal.reason);
		queue.push({ kind: "aborted" });
	};

	signal.addEventListener("abort", forwardAbort, { once: true });

	let finished = false;

	const fileEvents = (path: string, content: string): GenerationEvent[] => {
		emitted.set(path, content);
		const kind = kindOf(path);

		const screen =
			kind === "screen" && !original.has(path)
				? { screen: { name: screenNameFromPath(path), device: request.device } }
				: {};

		return [
			{ type: "file.start", path, kind, ...screen },
			{ type: "file.end", path, content },
		];
	};

	const baseline = (path: string) => (emitted.has(path) ? emitted.get(path) : original.get(path));

	const noteIgnored = (path: string): GenerationEvent[] => {
		if (RESERVED.has(path) || ignored.has(path) || path.split("/").some((part) => part.startsWith("."))) return [];
		ignored.add(path);

		return [{ type: "status", label: "Ignored a file outside screens/ and components/", detail: path }];
	};

	const pending = new Set<string>();
	let rescan = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let firstPendingAt = 0;
	let flushing: Promise<void> = Promise.resolve();

	const flush = async () => {
		timer = null;
		const paths = new Set(pending);
		pending.clear();

		if (rescan) {
			rescan = false;

			for (const path of await listFiles(dir)) paths.add(path);
		}

		for (const path of [...paths].sort()) {
			if (finished) return;

			if (!writable(path)) {
				if ((await readIfExists(join(dir, path))) !== null)
					for (const event of noteIgnored(path)) queue.push({ kind: "event", event });
				continue;
			}

			const content = await readIfExists(join(dir, path));

			// Deletions are reported once the agent is done
			if (content === null || content === baseline(path)) continue;

			for (const event of fileEvents(path, content)) queue.push({ kind: "event", event });
		}
	};

	const schedule = (name: string | null) => {
		if (finished) return;
		const path = name?.replace(/\\/g, "/");

		if (path && /\.[^/]+$/.test(path)) pending.add(path);
		else rescan = true;
		// Don't let a steady stream of writes postpone reporting forever
		const debounceMs = options.debounceMs ?? 150;

		if (timer && Date.now() - firstPendingAt < debounceMs * 4) clearTimeout(timer);
		else if (timer) return;
		else firstPendingAt = Date.now();
		timer = setTimeout(() => (flushing = flushing.then(flush, flush)), debounceMs);
	};

	let watcher: FSWatcher | null = null;

	try {
		watcher = watch(dir, { recursive: true }, (_event, name) => schedule(name ? String(name) : null));
		watcher.on?.("error", () => {});
	} catch {
		// Polling below still picks changes up, and the final diff reports everything
	}

	// File events can be late or dropped (FSEvents under load), so also rescan now and then
	const poller = setInterval(() => {
		if (finished || timer) return;
		rescan = true;
		flushing = flushing.then(flush, flush);
	}, options.pollMs ?? 1000);

	const pump = async () => {
		try {
			for await (const event of runAgent(dir, agentAbort.signal)) {
				if (event.type === "done") return queue.push({ kind: "agent-end", usage: event.usage });

				if (event.type === "error") return queue.push({ kind: "agent-end", error: event });

				if (event.type === "status" || event.type === "message.delta") queue.push({ kind: "event", event });
			}

			queue.push({ kind: "agent-end" });
		} catch (error) {
			queue.push({
				kind: "agent-end",
				error: {
					type: "error",
					code: "unknown",
					message: error instanceof Error ? error.message : String(error),
					retryable: false,
				},
			});
		}
	};

	try {
		void pump();

		while (true) {
			const item = await queue.next();

			if (item.kind === "aborted" || signal.aborted) {
				yield abortedEvent();

				return;
			}

			if (item.kind === "event") {
				yield item.event;
				continue;
			}

			finished = true;

			if (timer) clearTimeout(timer);
			clearInterval(poller);
			watcher?.close();
			watcher = null;
			await flushing;

			if (item.error) {
				yield item.error;

				return;
			}

			// Events the watcher queued while the agent was ending
			for (const queued of queue.drain()) if (queued.kind === "event") yield queued.event;
			const current = new Set((await listFiles(dir)).filter(writable));

			for (const path of [...new Set([...original.keys(), ...emitted.keys(), ...current])].sort()) {
				if (signal.aborted) break;

				if (current.has(path)) {
					const content = await readIfExists(join(dir, path));

					if (content !== null && content !== baseline(path)) yield* fileEvents(path, content);
				} else if (original.has(path) || emitted.has(path)) {
					yield { type: "file.delete", path };
				}
			}

			const given = new Set(request.files.map((file) => file.path));

			for (const path of await listFiles(dir)) if (!writable(path) && !given.has(path)) yield* noteIgnored(path);

			if (signal.aborted) {
				yield abortedEvent();

				return;
			}

			yield item.usage ? { type: "done", usage: item.usage } : { type: "done" };

			return;
		}
	} finally {
		finished = true;
		signal.removeEventListener("abort", forwardAbort);

		if (timer) clearTimeout(timer);
		clearInterval(poller);
		watcher?.close();
		agentAbort.abort();
		await flushing.catch(() => {});
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}
