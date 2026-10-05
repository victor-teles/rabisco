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

export function onFrameStatus(listener: (status: FrameStatus) => void) {
	statusListeners.add(listener);

	return () => void statusListeners.delete(listener);
}

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
			if (event.source === host.frame.contentWindow) {
				host.receive(event.data);

				return;
			}
		}
	});
}

export function hostOf(frame: HTMLIFrameElement | null | undefined): FrameHost | undefined {
	if (!frame) return undefined;

	for (const host of hosts) if (host.frame === frame) return host;

	return undefined;
}

const HIT_TEST_TIMEOUT_MS = 500;

let hitTestId = 0;

let requestId = 0;

type TrackedElement = { start: number | null; version: string };

export type Snapshot = { scene: Scene; raster?: { dataUrl: string; scale: number } };

function payloadOf(module: CompiledModule): ModulePayload {
	return module.error ? { source: module.source, error: module.error } : { source: module.source, code: module.code! };
}

/** Posts only the modules and CSS the frame doesn't have yet; unchanged graphs post nothing. */
export class FrameHost {
	readonly frame: HTMLIFrameElement;
	status: FrameStatus["status"] = "loading";
	error: FrameError | null = null;
	contentHeight: number | null = null;
	onContentHeight: ((height: number) => void) | null = null;
	#entry = "";
	#files: ProjectFiles = {};
	#ready = false;
	#waitingForStyles = false;
	#sent = new Map<string, string>();
	#sentEntry = "";
	#sentCss = "";
	#sentTheme = "";
	#unsubscribe: () => void;
	#hitTests = new Map<number, (hit: FrameHit | null) => void>();
	/** Re-sent when the frame reloads. */
	#tracked: TrackedElement = { start: null, version: "" };
	onBoxes: ((boxes: { start: number; version: string; boxes: Box[] }) => void) | null = null;
	#textEdit: { start: number; version: string; resolve: (text: string | null | undefined) => void } | null = null;
	/** Re-sent when the frame reloads. */
	#play = false;
	onNavigate: ((to: string) => void) | null = null;
	onEscape: (() => void) | null = null;
	#requests = new Map<number, (message: FrameMessage | null) => void>();
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

	async measure(timeoutMs = 5_000): Promise<number | null> {
		const reply = await this.#request({ type: "measure", id: ++requestId }, timeoutMs);

		return reply?.type === "measured" && Number.isFinite(reply.height) ? reply.height : null;
	}

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

	track(start: number | null, version: string) {
		if (start === this.#tracked.start && version === this.#tracked.version) return;
		this.#tracked = { start, version };

		if (this.#ready) this.#post({ type: "track", start, version });
	}

	/** Resolves with the new text, `null` if cancelled, or `undefined` if the frame refused. */
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

	setPlay(on: boolean) {
		if (on === this.#play) return;
		this.#play = on;

		if (this.#ready) this.#post({ type: "play", on });
	}

	endTextEdit(commit: boolean) {
		if (this.#textEdit) this.#post({ type: "end-edit", commit });
	}

	#onTextEditStart: (() => void) | null = null;

	/** Compare the hit's `version` with the file's `sourceVersion` before using its offsets. */
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
