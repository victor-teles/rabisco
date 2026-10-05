import { Component, useEffect, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
	heightReporter,
	locationOf,
	resolveHit,
	sourceVersion,
	type FrameError,
	type FrameMessage,
	type HostMessage,
} from "../lib/render/protocol";
import { describeError, hideOverlay, showOverlay } from "./errors";
import { externals } from "./externals";
import { boxesOf, boxOf, instancesOf, locatedAt } from "./inspect";
import { createPlay } from "./play";
import { rasterize } from "./raster";
import { ModuleRegistry, RenderError } from "./registry";
import { captureScene, contentHeight } from "./snapshot";
import { startTextEdit, type TextEdit } from "./text-edit";

const registry = new ModuleRegistry(externals);

const style = document.getElementById("rabisco-css") ?? document.head.appendChild(document.createElement("style"));

// DESIGN.md token overrides; appended after the main stylesheet so they win
const themeStyle = document.head.appendChild(document.createElement("style"));

let entry = "";

let version = 0;

let renderedVersion: string | null = null;

let tracked: { start: number; version: string; sent: string } | null = null;

let textEdit: TextEdit | null = null;

function post(message: FrameMessage) {
	// The host's origin is not visible from an opaque-origin frame
	window.parent.postMessage(message, "*");
}

function reportError(cause: unknown) {
	const described: FrameError = describeError(cause, (path) => registry.source(path));
	showOverlay(described);
	post({ type: "error", error: described });
}

const rootElement = document.getElementById("root")!;

const play = createPlay(rootElement, post);

const reportHeight = heightReporter((height) => post({ type: "size", height }));

function measure() {
	if (rootElement.scrollHeight > rootElement.clientHeight) return reportHeight(rootElement.scrollHeight);
	let bottom = 0;

	for (const child of rootElement.children)
		bottom = Math.max(bottom, child.getBoundingClientRect().bottom + window.scrollY);
	reportHeight(bottom);
}

function reportBoxes() {
	if (!tracked || !entry || tracked.version !== renderedVersion) return;
	const boxes = boxesOf(instancesOf(rootElement, locationOf(entry, tracked.start)));
	const sent = JSON.stringify(boxes);

	if (sent === tracked.sent) return;
	tracked.sent = sent;
	post({ type: "boxes", start: tracked.start, version: tracked.version, boxes });
}

let measuring = 0;

const scheduleMeasure = () => {
	cancelAnimationFrame(measuring);
	measuring = requestAnimationFrame(() => {
		measure();
		reportBoxes();

		if (play.playing) play.refresh();
	});
};

const resizes = new ResizeObserver(scheduleMeasure);

resizes.observe(rootElement);

new MutationObserver(() => {
	for (const child of rootElement.children) resizes.observe(child);
	scheduleMeasure();
}).observe(rootElement, { childList: true, subtree: true, characterData: true });

// Images and fonts change the height after the first layout
document.addEventListener("load", scheduleMeasure, true);

void document.fonts?.ready.then(scheduleMeasure);

const root = createRoot(rootElement, {
	onUncaughtError: (error) => reportError(error),
});

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch(cause: unknown, _info: ErrorInfo) {
		reportError(cause);
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
}

/** Reports the commit only after the screen's own effects have run. */
function Rendered({ source, children }: { source: string; children: ReactNode }) {
	useEffect(() => {
		renderedVersion = source;
		hideOverlay();
		post({ type: "rendered" });
		scheduleMeasure();
	}, [source]);

	return children;
}

function isComponent(value: unknown): value is ComponentType {
	return typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value);
}

function render() {
	let Screen: ComponentType;

	try {
		const exported = registry.load(entry).default;

		if (!isComponent(exported))
			throw new RenderError(
				"runtime",
				`${entry} has no default export. Add \`export default function Screen() {…}\`.`,
				entry,
			);
		Screen = exported;
	} catch (error) {
		reportError(error);

		return;
	}

	version++;
	textEdit?.finish(false);
	root.render(
		<Boundary key={version}>
			<Rendered source={sourceVersion(registry.source(entry) ?? "")}>
				<Screen />
			</Rendered>
		</Boundary>,
	);
}

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
	if (event.source !== window.parent) return;
	const message = event.data;

	if (message?.type === "hit-test") {
		const located = entry && renderedVersion ? locatedAt(message.x, message.y) : [];

		const hit = located.length
			? resolveHit(
					located.map((item) => item.loc),
					entry,
				)
			: null;

		post({
			type: "hit",
			id: message.id,
			hit:
				hit && renderedVersion
					? {
							path: hit.path,
							starts: hit.starts,
							version: renderedVersion,
							boxes: hit.indices.map((i) => boxOf(located[i]!.elements)),
						}
					: null,
		});
	} else if (message?.type === "track") {
		tracked = message.start === null ? null : { start: message.start, version: message.version, sent: "" };
		reportBoxes();
	} else if (message?.type === "edit-text") {
		textEdit?.finish(true);
		const { start, version: editVersion } = message;
		const refuse = () => post({ type: "text-edit", start, version: editVersion, state: "refused" });

		if (!entry || editVersion !== renderedVersion) return refuse();
		const loc = locationOf(entry, start);

		const under =
			message.x === undefined || message.y === undefined
				? undefined
				: locatedAt(message.x, message.y).find((item) => item.loc === loc);

		const elements = under?.elements ?? instancesOf(rootElement, loc)[0] ?? [];
		textEdit = startTextEdit(elements, message.text, (text) => {
			textEdit = null;
			post({ type: "text-edit", start, version: editVersion, state: "done", text });
		});

		if (textEdit) post({ type: "text-edit", start, version: editVersion, state: "editing" });
		else refuse();
	} else if (message?.type === "end-edit") {
		textEdit?.finish(message.commit);
	} else if (message?.type === "measure") {
		post({ type: "measured", id: message.id, height: contentHeight() });
	} else if (message?.type === "snapshot") {
		const { id, raster } = message;
		void (async () => {
			try {
				const scene = await captureScene(rootElement);
				const image = raster ? await rasterize(scene, raster) : undefined;
				post(
					image
						? { type: "snapshot", id, scene, raster: { dataUrl: image.dataUrl, scale: image.scale } }
						: { type: "snapshot", id, scene },
				);
			} catch (error) {
				post({ type: "snapshot", id, error: error instanceof Error ? error.message : String(error) });
			}
		})();
	} else if (message?.type === "play") {
		play.set(message.on === true);
	} else if (message?.type === "css") {
		style.textContent = message.css;
	} else if (message?.type === "theme") {
		themeStyle.textContent = message.css;
	} else if (message?.type === "modules") {
		if (message.css !== undefined) style.textContent = message.css;

		if (message.theme !== undefined) themeStyle.textContent = message.theme;
		const invalid = registry.apply(message.modules, message.reset);
		const entryChanged = message.entry !== entry;

		// Play mode navigates within one frame, so reset scroll on screen change
		if (entryChanged && entry) window.scrollTo(0, 0);
		entry = message.entry;

		if (entryChanged || invalid.has(entry) || !registry.isLoaded(entry)) render();
	}
});

window.addEventListener("error", (event) => reportError(event.error ?? event.message));

window.addEventListener("unhandledrejection", (event) => reportError(event.reason));

post({ type: "ready" });
