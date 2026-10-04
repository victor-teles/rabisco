import type { ProjectFiles } from "../../../shared/types";
import { compileCache, type CompiledModule } from "./compile";
import { collectGraph } from "./graph";
import type { FrameError, FrameMessage, HostMessage, ModulePayload } from "./protocol";
import { screenStyles } from "./styles";

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
	window.addEventListener("message", (event: MessageEvent<FrameMessage>) => {
		if (!event.source) return;
		for (const host of hosts) {
			// Only trust messages that come from the frame's own window
			if (event.source === host.frame.contentWindow) {
				host.receive(event.data);
				return;
			}
		}
	});
}

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
	#entry = "";
	#files: ProjectFiles = {};
	#ready = false;
	#waitingForStyles = false;
	/** Module hashes the frame has, by path */
	#sent = new Map<string, string>();
	#sentEntry = "";
	#sentCss = "";
	#unsubscribe: () => void;

	constructor(frame: HTMLIFrameElement) {
		this.frame = frame;
		hosts.add(this);
		listen();
		this.#unsubscribe = screenStyles.subscribe((css) => this.#pushCss(css));
	}

	dispose() {
		hosts.delete(this);
		this.#unsubscribe();
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
			this.#emit({ status: "ready" });
			this.#sync();
		} else if (message?.type === "rendered") {
			this.#emit({ status: "rendered" });
		} else if (message?.type === "error") {
			this.#emit({ status: "error", error: message.error });
		}
	}

	#emit(status: { status: "ready" | "rendered" } | { status: "error"; error: FrameError }) {
		this.status = status.status;
		this.error = status.status === "error" ? status.error : null;
		const event = { frame: this.frame, entry: this.#entry, ...status } as FrameStatus;
		for (const listener of statusListeners) listener(event);
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
		if (!changed && !reset && this.#entry === this.#sentEntry && css === undefined) return;

		this.#post({ type: "modules", entry: this.#entry, modules, css, reset });
		for (const [path, payload] of Object.entries(modules)) {
			if (payload) this.#sent.set(path, graph.modules.get(path)!.hash);
			else this.#sent.delete(path);
		}
		this.#sentEntry = this.#entry;
		if (css !== undefined) this.#sentCss = css;
	}
}
