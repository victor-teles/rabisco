// Images of frames that aren't mounted (Phase 9). One capture runs at a time; frames that were never live
// render in a single hidden frame.
import type { ProjectFiles } from "../../../shared/types";
import { compileCache, hashString } from "./compile";
import { FrameHost, onFrameStatus, runtimeUrl } from "./frame-host";
import { collectGraph } from "./graph";
import { OFFSTAGE_FRAME_STYLE, offstage } from "./offstage";
import type { SnapshotRaster } from "./protocol";

const MAX_SNAPSHOTS = 48;

/** Snapshots show at low zoom, so half the CSS size is plenty. */
const RASTER: SnapshotRaster = { type: "image/jpeg", scale: 0.5, quality: 0.82 };

const CAPTURE_TIMEOUT_MS = 10_000;

const RENDER_TIMEOUT_MS = 8_000;

const IDLE_MS = 120;

const WORKER_IDLE_MS = 20_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function graphHash(entry: string, files: ProjectFiles) {
	const graph = collectGraph(entry, files, compileCache);

	return hashString([...graph.modules.values()].map((module) => module.hash).join(","));
}

/** Changes whenever what the frame shows does: its modules, theme or size. */
export function snapshotKey(entry: string, files: ProjectFiles, theme: string, width: number, height: number) {
	return `${entry}\0${width}x${height}\0${graphHash(entry, files)}\0${hashString(theme)}`;
}

/** Data URLs, oldest first. */
const snapshots = new Map<string, string>();

/** Keys whose screen failed to render; they get the placeholder. */
const failed = new Set<string>();

const listeners = new Set<() => void>();

export function subscribeSnapshots(listener: () => void) {
	listeners.add(listener);

	return () => void listeners.delete(listener);
}

export const cachedSnapshot = (key: string) => snapshots.get(key);

function store(key: string, url: string) {
	snapshots.delete(key);
	snapshots.set(key, url);

	for (const oldest of snapshots.keys()) {
		if (snapshots.size <= MAX_SNAPSHOTS) break;
		snapshots.delete(oldest);
	}

	for (const listener of listeners) listener();
}

const enum Priority {
	/** A frame waits for it to unmount. */
	Unmount,
	/** A live frame settled. */
	Settled,
	/** A frame that was never live. */
	Background,
}

type Task = { priority: Priority; run: () => Promise<void>; done: (() => void)[] };

const tasks = new Map<string, Task>();

let running = false;

function enqueue(key: string, priority: Priority, run: () => Promise<void>): Promise<void> {
	return new Promise((resolve) => {
		const queued = tasks.get(key);
		const done = [...(queued?.done ?? []), resolve];
		tasks.set(key, queued && queued.priority <= priority ? { ...queued, done } : { priority, run, done });
		void pump();
	});
}

function nextTask(): [string, Task] | undefined {
	let best: [string, Task] | undefined;

	for (const entry of tasks) if (!best || entry[1].priority < best[1].priority) best = entry;

	return best;
}

async function pump() {
	if (running) return;
	running = true;
	clearTimeout(workerTimer);

	for (let next = nextTask(); next; next = nextTask()) {
		// Captures borrow the main thread: leave room for input between them
		if (next[1].priority !== Priority.Unmount) {
			await wait(IDLE_MS);
			next = nextTask();

			if (!next) break;
		}

		const [key, task] = next;
		tasks.delete(key);

		try {
			if (!snapshots.has(key)) await task.run();
		} catch {
			// The frame went away or timed out: it shows the last snapshot or the placeholder
		}

		for (const resolve of task.done) resolve();
	}

	running = false;
	workerTimer = setTimeout(disposeWorker, WORKER_IDLE_MS);
}

async function capture(host: FrameHost, key: string, height: number) {
	const snapshot = await host.snapshot({ ...RASTER, maxHeight: height }, CAPTURE_TIMEOUT_MS);

	if (snapshot.raster) store(key, snapshot.raster.dataUrl);
}

/** `current` is checked when the capture's turn comes, since the frame may have changed or unmounted by then. */
export function captureLive(
	host: FrameHost,
	key: string,
	height: number,
	urgent: boolean,
	current: () => boolean,
): Promise<void> {
	if (snapshots.has(key)) return Promise.resolve();

	return enqueue(key, urgent ? Priority.Unmount : Priority.Settled, async () => {
		if (current() && host.status === "rendered") await capture(host, key, height);
	});
}

let worker: { frame: HTMLIFrameElement; host: FrameHost; rendered: string } | null = null;

let workerTimer: ReturnType<typeof setTimeout> | undefined;

function disposeWorker() {
	worker?.host.dispose();
	worker?.frame.remove();
	worker = null;
}

function workerFrame() {
	if (worker) return worker;
	const frame = document.createElement("iframe");
	frame.src = runtimeUrl();
	frame.sandbox.add("allow-scripts");
	frame.tabIndex = -1;
	frame.setAttribute("aria-hidden", "true");
	frame.style.cssText = OFFSTAGE_FRAME_STYLE;
	offstage().appendChild(frame);
	worker = { frame, host: new FrameHost(frame), rendered: "" };

	return worker;
}

function nextRender(frame: HTMLIFrameElement): Promise<boolean> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => finish(true), RENDER_TIMEOUT_MS);

		const unsubscribe = onFrameStatus((status) => {
			if (status.frame !== frame || (status.status !== "rendered" && status.status !== "error")) return;
			finish(status.status === "rendered");
		});

		function finish(ok: boolean) {
			clearTimeout(timer);
			unsubscribe();
			resolve(ok);
		}
	});
}

export type SnapshotJob = {
	key: string;
	entry: string;
	files: ProjectFiles;
	theme: string;
	width: number;
	height: number;
};

export const snapshotFailed = (key: string) => failed.has(key);

/** For frames that were never live: renders the screen in a hidden frame, then captures it. */
export function renderSnapshot(job: SnapshotJob, wanted: () => boolean): Promise<void> {
	if (snapshots.has(job.key) || failed.has(job.key)) return Promise.resolve();

	return enqueue(job.key, Priority.Background, async () => {
		if (!wanted()) return;
		const current = workerFrame();
		const { frame, host } = current;
		const screen = `${job.entry}\0${graphHash(job.entry, job.files)}`;
		frame.style.width = `${job.width}px`;
		frame.style.height = `${job.height}px`;

		if (screen !== current.rendered || host.status !== "rendered") {
			const rendered = nextRender(frame);
			host.update(job.entry, job.files, job.theme);

			if (!(await rendered)) {
				current.rendered = "";
				failed.add(job.key);

				return;
			}

			current.rendered = screen;
		} else {
			// Same screen and modules: only the theme or the size changed, which needs no render
			host.update(job.entry, job.files, job.theme);
			await new Promise(requestAnimationFrame);
		}

		await capture(host, job.key, job.height);
	});
}
