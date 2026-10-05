import type { Scene } from "../../../shared/export/scene";
import type { ProjectFiles } from "../../../shared/types";
import { compileCache, type CompiledModule } from "./compile";
import { collectGraph } from "./graph";
import {
	hitBoxes,
	isFrameMessage,
	type Box,
	type FrameError,
	type FrameHit,
	type FrameMessage,
	type HostMessage,
	type ModulePayload,
	type SnapshotRaster,
} from "./protocol";
import { screenStyles } from "./styles";
import { designThemeCss } from "./theme";

export type FrameStatus = {
	frame: HTMLIFrameElement;
	entry: string;
} & ({ status: "loading" | "ready" | "rendered" } | { status: "error"; error: FrameError });

const statusListeners = new Set<(status: FrameStatus) => void>();

/** Subscribes to status changes of every screen frame. Returns an unsubscribe function. */
export function onFrameStatus(listener: (status: FrameStatus) => void) {
	statusListeners.add(listener);

	return () => void statusListeners.delete(listener);
}

/** URL of the screen runtime, next to the app document (dev server or views://mainview/). */
export function runtimeUrl() {
	return new URL("./runtime/frame.html", document.baseURI).href;
}

const hosts = new Set<FrameHost>();

let listening = false;

function listen() {
	if (listening) return;
	listening = true;
	window.addEventListener("message", (event: MessageEvent) => {
		if (!event.source || !isFrameMessage(event.data)) return;

		for (const host of hosts) {
			// Only trust messages that come from the frame's own window
			if (event.source === host.frame.contentWindow) {
				host.receive(event.data);

				return;
			}
		}
	});
}

/** The host feeding `frame`, if it has one. */
export function hostOf(frame: HTMLIFrameElement | null | undefined): FrameHost | undefined {
	if (!frame) return undefined;

	for (const host of hosts) if (host.frame === frame) return host;

	return undefined;
}

/** How long `hitTest` waits for the frame before giving up */
const HIT_TEST_TIMEOUT_MS = 500;

let hitTestId = 0;

/** Ids of `measure` and `snapshot` requests */
let requestId = 0;

/** The entry element `track` follows, in the entry source with `version`; `start: null` follows nothing. */
type TrackedElement = { start: number | null; version: string };

/** What `FrameHost.snapshot` resolves with: the screen as a scene, and its raster when asked for. */
export type Snapshot = { scene: Scene; raster?: { dataUrl: string; scale: number } };

function payloadOf(module: CompiledModule): ModulePayload {
	return module.error ? { source: module.source, error: module.error } : { source: module.source, code: module.code! };
}

/**
 * Feeds one screen frame: compiles the entry's module graph, and posts only the modules and
 * CSS the frame does not have yet. Frames whose graph did not change receive nothing.
 */
export class FrameHost {
	readonly frame: HTMLIFrameElement;
	status: FrameStatus["status"] = "loading";
	error: FrameError | null = null;
	/** The screen's content height as the frame last reported it */
	contentHeight: number | null = null;
	/** Called when the frame reports a new content height */
	onContentHeight: ((height: number) => void) | null = null;
	#entry = "";
	#files: ProjectFiles = {};
	#ready = false;
	#waitingForStyles = false;
	/** Module hashes the frame has, by path */
	#sent = new Map<string, string>();
	#sentEntry = "";
	#sentCss = "";
	/** DESIGN.md token overrides the frame has */
	#sentTheme = "";
	#unsubscribe: () => void;
	/** Unanswered `hitTest` calls by id */
	#hitTests = new Map<number, (hit: FrameHit | null) => void>();
	/** What `track` asked for, re-sent when the frame reloads */
	#tracked: TrackedElement = { start: null, version: "" };
	/** Receives the tracked element's boxes */
	onBoxes: ((boxes: { start: number; version: string; boxes: Box[] }) => void) | null = null;
	/** The text edit in progress, as `editText` started it */
	#textEdit: { start: number; version: string; resolve: (text: string | null | undefined) => void } | null = null;
	/** Play mode, as `setPlay` asked for it; re-sent when the frame reloads */
	#play = false;
	/** Play mode: a linked element was clicked; `to` is its `data-link-to` as written */
	onNavigate: ((to: string) => void) | null = null;
	/** Play mode: Escape was pressed inside the frame and the screen didn't handle it */
	onEscape: (() => void) | null = null;
	/** Unanswered `measure` and `snapshot` calls by id; `null` when the host is disposed */
	#requests = new Map<number, (message: FrameMessage | null) => void>();
	/** `whenRendered` calls waiting for the next render status */
	#renderWaiters = new Set<(status: FrameStatus["status"]) => void>();

	constructor(frame: HTMLIFrameElement) {
		this.frame = frame;
		hosts.add(this);
		listen();
		this.#unsubscribe = screenStyles.subscribe((css) => this.#pushCss(css));
	}

	dispose() {
		hosts.delete(this);
		this.#unsubscribe();

		for (const resolve of this.#hitTests.values()) resolve(null);
		this.#hitTests.clear();
		this.#textEdit?.resolve(null);
		this.#textEdit = null;

		for (const resolve of this.#requests.values()) resolve(null);
		this.#requests.clear();

		for (const waiter of this.#renderWaiters) waiter("loading");
		this.#renderWaiters.clear();
	}

	/**
	 * Resolves once the frame has rendered the screen, at once when it already
	 * has. Rejects when it reports an error, is disposed or takes longer than
	 * `timeoutMs`.
	 */
	whenRendered(timeoutMs = 15_000): Promise<void> {
		if (this.status === "rendered") return Promise.resolve();

		if (this.status === "error") return Promise.reject(new Error(this.error?.message ?? "The screen didn't render"));

		return new Promise((resolve, reject) => {
			const done = (status: FrameStatus["status"]) => {
				if (status === "ready") return;
				clearTimeout(timer);
				this.#renderWaiters.delete(done);

				if (status === "rendered") resolve();
				else
					reject(
						new Error(
							status === "error" ? (this.error?.message ?? "The screen didn't render") : "The frame was closed",
						),
					);
			};

			const timer = setTimeout(() => {
				this.#renderWaiters.delete(done);
				reject(new Error("The screen took too long to render"));
			}, timeoutMs);

			this.#renderWaiters.add(done);
		});
	}

	/** Image export: the screen's content height in CSS pixels; `null` when the frame doesn't answer. */
	async measure(timeoutMs = 5_000): Promise<number | null> {
		const reply = await this.#request({ type: "measure", id: ++requestId }, timeoutMs);

		return reply?.type === "measured" && Number.isFinite(reply.height) ? reply.height : null;
	}

	/**
	 * Image export: the rendered screen as a `Scene` (and a PNG or JPEG of it
	 * with `raster`). Rejects when the frame isn't ready, fails or times out.
	 */
	async snapshot(raster?: SnapshotRaster, timeoutMs = 60_000): Promise<Snapshot> {
		if (!this.#ready) throw new Error("The frame isn't ready");
		const request: HostMessage & { id: number } = { type: "snapshot", id: ++requestId };

		if (raster) request.raster = raster;
		const reply = await this.#request(request, timeoutMs);

		if (reply?.type !== "snapshot")
			throw new Error(reply === null ? "The screen didn't answer in time" : "Unexpected reply");

		if ("error" in reply) throw new Error(reply.error);
		const { scene, raster: image } = reply;

		if (raster && !image) throw new Error("The screen sent no image");

		return image ? { scene, raster: image } : { scene };
	}

	/** Posts `message` and resolves with the reply that has its id, or `null` on timeout or dispose. */
	#request(message: HostMessage & { id: number }, timeoutMs: number): Promise<FrameMessage | null> {
		if (!this.#ready) return Promise.resolve(null);

		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.#requests.delete(message.id);
				resolve(null);
			}, timeoutMs);

			this.#requests.set(message.id, (reply) => {
				clearTimeout(timer);
				this.#requests.delete(message.id);
				resolve(reply);
			});
			this.#post(message);
		});
	}

	/**
	 * Follows the entry element at `start` of the entry source with version
	 * `version`: `onBoxes` receives its boxes once the frame shows that version,
	 * and again whenever its layout changes. `null` stops.
	 */
	track(start: number | null, version: string) {
		if (start === this.#tracked.start && version === this.#tracked.version) return;
		this.#tracked = { start, version };

		if (this.#ready) this.#post({ type: "track", start, version });
	}

	/**
	 * Edits the text of the entry element at `start` in place, in the instance
	 * under frame-local `x`, `y` when given. Resolves with the new text when the
	 * edit is kept, `null` when it is cancelled, and `undefined` when the frame
	 * refused (its DOM doesn't hold just that text: edit it elsewhere).
	 * `onStart` runs once the frame is editing.
	 */
	editText(
		edit: { start: number; version: string; text: string; x?: number; y?: number },
		onStart?: () => void,
	): Promise<string | null | undefined> {
		this.#textEdit?.resolve(null);

		if (!this.#ready) return Promise.resolve(undefined);

		return new Promise((resolve) => {
			this.#textEdit = {
				start: edit.start,
				version: edit.version,
				resolve: (text) => ((this.#textEdit = null), resolve(text)),
			};
			this.#onTextEditStart = onStart ?? null;
			this.#post({ type: "edit-text", ...edit });
		});
	}

	/**
	 * Turns play mode on or off (decision 0007): the frame follows clicks on
	 * linked elements by calling `onNavigate` instead of their default.
	 */
	setPlay(on: boolean) {
		if (on === this.#play) return;
		this.#play = on;

		if (this.#ready) this.#post({ type: "play", on });
	}

	/** Ends the text edit in progress: keeps the text, or puts the old one back. */
	endTextEdit(commit: boolean) {
		if (this.#textEdit) this.#post({ type: "end-edit", commit });
	}

	#onTextEditStart: (() => void) | null = null;

	/**
	 * The entry screen's JSX elements at frame-local CSS pixel `x`, `y`: start
	 * offsets in the entry file, innermost first, and the version of the entry
	 * source they refer to (compare it with `sourceVersion` of the file before
	 * using them). `null` when nothing of the screen's own source is there, the
	 * frame isn't ready, or it doesn't answer in time.
	 */
	hitTest(x: number, y: number): Promise<FrameHit | null> {
		if (!this.#ready || !this.#sentEntry) return Promise.resolve(null);
		const id = ++hitTestId;

		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.#hitTests.delete(id);
				resolve(null);
			}, HIT_TEST_TIMEOUT_MS);

			this.#hitTests.set(id, (hit) => {
				clearTimeout(timer);
				this.#hitTests.delete(id);
				resolve(hit);
			});
			this.#post({ type: "hit-test", id, x, y });
		});
	}

	update(entry: string, files: ProjectFiles) {
		this.#entry = entry;
		this.#files = files;
		this.#sync();
	}

	receive(message: FrameMessage) {
		if (message?.type === "ready") {
			// A (re)loaded frame starts empty
			this.#ready = true;
			this.#sent.clear();
			this.#sentEntry = "";
			this.#sentCss = "";
			this.#sentTheme = "";
			this.#textEdit?.resolve(null);
			this.#emit({ status: "ready" });
			this.#sync();

			if (this.#tracked.start !== null) this.#post({ type: "track", ...this.#tracked });

			if (this.#play) this.#post({ type: "play", on: true });
		} else if (message?.type === "rendered") {
			this.#emit({ status: "rendered" });
		} else if (message?.type === "error") {
			this.#emit({ status: "error", error: message.error });
		} else if (message?.type === "hit") {
			// Only the entry's own elements are drop targets
			const hit = message.hit;

			const valid =
				!!hit &&
				hit.path === this.#sentEntry &&
				hit.starts.length > 0 &&
				hit.starts.every((start) => Number.isInteger(start) && start >= 0);

			this.#hitTests.get(message.id)?.(
				hit && valid
					? {
							path: hit.path,
							starts: [...hit.starts],
							version: hit.version,
							boxes: hitBoxes(hit.boxes, hit.starts.length),
						}
					: null,
			);
		} else if (message?.type === "boxes") {
			const current = message.start === this.#tracked.start && message.version === this.#tracked.version;

			if (current) this.onBoxes?.({ start: message.start, version: message.version, boxes: message.boxes });
		} else if (message?.type === "text-edit") {
			const edit = this.#textEdit;

			if (!edit || message.start !== edit.start || message.version !== edit.version) return;

			if (message.state === "editing") this.#onTextEditStart?.();
			else if (message.state === "refused") edit.resolve(undefined);
			else if (message.state === "done") edit.resolve(message.text);
		} else if (message?.type === "navigate") {
			if (this.#play && message.to.trim()) this.onNavigate?.(message.to);
		} else if (message?.type === "measured" || message?.type === "snapshot") {
			this.#requests.get(message.id)?.(message);
		} else if (message?.type === "escape") {
			if (this.#play) this.onEscape?.();
		} else if (message?.type === "size" && message.height !== this.contentHeight) {
			this.contentHeight = message.height;
			this.onContentHeight?.(message.height);
		}
	}

	#emit(status: { status: "ready" | "rendered" } | { status: "error"; error: FrameError }) {
		this.status = status.status;
		this.error = status.status === "error" ? status.error : null;
		const event: FrameStatus = { frame: this.frame, entry: this.#entry, ...status };

		for (const listener of statusListeners) listener(event);

		// A waiter removes itself when called, which a Set's iteration tolerates
		for (const waiter of this.#renderWaiters) waiter(status.status);
	}

	#post(message: HostMessage) {
		// The frame has an opaque origin, so no target origin can match it
		this.frame.contentWindow?.postMessage(message, "*");
	}

	#pushCss(css: string) {
		if (!this.#ready || !this.#sentEntry || css === this.#sentCss) return;
		this.#sentCss = css;
		this.#post({ type: "css", css });
	}

	#sync() {
		if (!this.#ready || !this.#entry) return;

		if (!screenStyles.ready) {
			if (!this.#waitingForStyles) {
				this.#waitingForStyles = true;
				void screenStyles.whenReady().then(() => {
					this.#waitingForStyles = false;
					this.#sync();
				});
			}

			return;
		}

		const graph = collectGraph(this.#entry, this.#files, compileCache);
		const modules: Record<string, ModulePayload | null> = {};
		let changed = false;

		for (const [path, module] of graph.modules) {
			if (this.#sent.get(path) === module.hash) continue;
			screenStyles.add(module.candidates);
			modules[path] = payloadOf(module);
			changed = true;
		}

		for (const path of this.#sent.keys()) {
			if (!graph.modules.has(path)) {
				modules[path] = null;
				changed = true;
			}
		}

		const reset = this.#sentEntry === "";
		const css = screenStyles.css !== this.#sentCss ? screenStyles.css : undefined;
		const themeCss = designThemeCss(this.#files);
		const theme = themeCss !== this.#sentTheme ? themeCss : undefined;

		if (!changed && !reset && this.#entry === this.#sentEntry && css === undefined) {
			// Only the tokens changed: restyle without touching the modules
			if (theme !== undefined) {
				this.#sentTheme = theme;
				this.#post({ type: "theme", css: theme });
			}

			return;
		}

		this.#post({ type: "modules", entry: this.#entry, modules, css, theme, reset });

		for (const [path, payload] of Object.entries(modules)) {
			if (payload) this.#sent.set(path, graph.modules.get(path)!.hash);
			else this.#sent.delete(path);
		}

		this.#sentEntry = this.#entry;

		if (css !== undefined) this.#sentCss = css;

		if (theme !== undefined) this.#sentTheme = theme;
	}
}
