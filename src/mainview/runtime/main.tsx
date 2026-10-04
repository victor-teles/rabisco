/**
 * Screen runtime: runs inside each sandboxed frame. Receives compiled modules and CSS from the
 * host, links them with the runtime's React and shadcn components, and renders the entry screen.
 */
import { Component, useEffect, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { FrameError, FrameMessage, HostMessage } from "../lib/render/protocol";
import { describeError, hideOverlay, showOverlay } from "./errors";
import { externals } from "./externals";
import { ModuleRegistry, RenderError } from "./registry";

const registry = new ModuleRegistry(externals);
const style = document.getElementById("rabisco-css") ?? document.head.appendChild(document.createElement("style"));
let entry = "";
let version = 0;

function post(message: FrameMessage) {
	// The host's origin is not visible from an opaque-origin frame
	window.parent.postMessage(message, "*");
}

function reportError(error: unknown) {
	const described: FrameError = describeError(error, (path) => registry.source(path));
	showOverlay(described);
	post({ type: "error", error: described });
}

const root = createRoot(document.getElementById("root")!, {
	onUncaughtError: (error) => reportError(error),
});

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch(error: unknown, _info: ErrorInfo) {
		reportError(error);
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
}

/** Reports a successful commit once the screen's own effects have run. */
function Rendered({ children }: { children: ReactNode }) {
	useEffect(() => {
		hideOverlay();
		post({ type: "rendered" });
	}, []);
	return children;
}

function render() {
	let Screen: ComponentType;
	try {
		Screen = registry.load(entry).default as ComponentType;
		const isComponent = typeof Screen === "function" || (typeof Screen === "object" && Screen !== null && "$$typeof" in Screen);
		if (!isComponent) throw new RenderError("runtime", `${entry} has no default export. Add \`export default function Screen() {…}\`.`, entry);
	} catch (error) {
		reportError(error);
		return;
	}
	version++;
	root.render(
		<Boundary key={version}>
			<Rendered>
				<Screen />
			</Rendered>
		</Boundary>,
	);
}

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
	if (event.source !== window.parent) return;
	const message = event.data;
	if (message?.type === "css") {
		style.textContent = message.css;
	} else if (message?.type === "modules") {
		if (message.css !== undefined) style.textContent = message.css;
		const invalid = registry.apply(message.modules, message.reset);
		const entryChanged = message.entry !== entry;
		entry = message.entry;
		// Re-run only when the entry or something it loaded changed (or it never loaded)
		if (entryChanged || invalid.has(entry) || !registry.isLoaded(entry)) render();
	}
});

window.addEventListener("error", (event) => reportError(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => reportError(event.reason));

post({ type: "ready" });
