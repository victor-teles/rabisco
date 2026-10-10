import { Component, useEffect, useLayoutEffect, type ComponentType, type ErrorInfo, type ReactNode } from "react";
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
import { frameAssets } from "./assets";
import { lintScreen } from "./design-lint";
import { describeError, hideOverlay, showOverlay } from "./errors";
import { externals } from "./externals";
import { preloadIcons } from "./icons";
import { boxesOf, boxOf, dropLayoutOf, instancesOf, layoutOf, locatedAt, spacingOf } from "./inspect";
import { createPlay } from "./play";
import { clearOrder, previewOrder } from "./reorder";
import { rasterize } from "./raster";
import { ModuleRegistry, RenderError } from "./registry";
import { captureScene, contentHeight, settle } from "./snapshot";
import { startTextEdit, type TextEdit } from "./text-edit";

const registry = new ModuleRegistry(externals);

const style = document.getElementById("rabisco-css") ?? document.head.appendChild(document.createElement("style"));

// DESIGN.md token overrides; appended after the main stylesheet so they win
const themeStyle = document.head.appendChild(document.createElement("style"));

/** As the host sent it: `url()`s to project images are rewritten again when the images change */
let css = "";

function setCss(next: string) {
	css = next;
	style.textContent = frameAssets.css(next);
}

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
	const instances = instancesOf(rootElement, locationOf(entry, tracked.start));
	const boxes = boxesOf(instances);
	const spacing = instances[0] ? spacingOf(instances[0]) : null;
	const layout = instances[0] ? layoutOf(instances[0]) : null;
	const sent = JSON.stringify([boxes, spacing, layout]);

	if (sent === tracked.sent) return;
	tracked.sent = sent;
	post({ type: "boxes", start: tracked.start, version: tracked.version, boxes, spacing, layout });
}

type PreviewedProperty = {
	style: CSSStyleDeclaration;
	property: string;
	before: string;
	priority: string;
	set: string;
};

/** What `preview-style` changed, so it can be put back */
let previewed: PreviewedProperty[] = [];

/** Leaves a property alone when something else (a render) changed it since */
function clearPreview() {
	for (const { style, property, before, priority, set } of previewed) {
		if (style.getPropertyValue(property) !== set) continue;

		if (before) style.setProperty(property, before, priority);
		else style.removeProperty(property);
	}

	previewed = [];
}

const hasStyle = (element: Element): element is HTMLElement | SVGElement =>
	element instanceof HTMLElement || element instanceof SVGElement;

function previewStyle(start: number, styles: Record<string, string>) {
	clearPreview();

	for (const elements of instancesOf(rootElement, locationOf(entry, start))) {
		for (const element of elements) {
			if (!hasStyle(element)) continue;
			const { style } = element;

			for (const [property, value] of Object.entries(styles)) {
				const before = style.getPropertyValue(property);
				const priority = style.getPropertyPriority(property);
				// Over `!` classes too
				style.setProperty(property, value, "important");
				previewed.push({ style, property, before, priority, set: style.getPropertyValue(property) });
			}
		}
	}

	scheduleMeasure();
}

let measuring = 0;

/** Offscreen frames don't observe layout; resuming measures once. */
let paused = false;

const scheduleMeasure = () => {
	if (paused) return;
	cancelAnimationFrame(measuring);
	measuring = requestAnimationFrame(() => {
		measure();
		reportBoxes();

		if (play.playing) play.refresh();
	});
};

const resizes = new ResizeObserver(scheduleMeasure);

const mutations = new MutationObserver(() => {
	for (const child of rootElement.children) resizes.observe(child);
	scheduleMeasure();
});

function observe() {
	resizes.observe(rootElement);

	for (const child of rootElement.children) resizes.observe(child);
	mutations.observe(rootElement, { childList: true, subtree: true, characterData: true });
}

observe();

function setPaused(on: boolean) {
	if (on === paused) return;
	paused = on;

	if (on) {
		cancelAnimationFrame(measuring);
		resizes.disconnect();
		mutations.disconnect();
	} else {
		observe();
		scheduleMeasure();
	}
}

// Images and fonts change the height after the first layout
document.addEventListener("load", scheduleMeasure, true);

void document.fonts?.ready.then(scheduleMeasure);

const root = createRoot(rootElement, {
	onUncaughtError: (error) => reportError(error),
});

/** Bumped to remount the screen: React reconciles every other version. */
let mount = 0;

/** The version that already got a fresh mount after an error. */
let remounted = -1;

/** A failed version renders nothing; the next version renders its children again. */
class Boundary extends Component<{ version: number; children: ReactNode }, { failed: boolean; version: number }> {
	state = { failed: false, version: this.props.version };
	static getDerivedStateFromProps(props: { version: number }, state: { version: number }) {
		return props.version === state.version ? null : { failed: false, version: props.version };
	}
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch(cause: unknown, _info: ErrorInfo) {
		// Kept state may not fit the new code (or the hooks changed): try once from scratch before reporting
		if (remounted !== this.props.version) {
			remounted = this.props.version;
			mount++;
			mountScreen();
		} else reportError(cause);
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
}

/** Reports the commit only after the screen's own effects have run. */
function Rendered({ source, version, children }: { source: string; version: number; children: ReactNode }) {
	// Before paint: the committed DOM already shows the new order, and a frame with both would jump
	useLayoutEffect(() => clearOrder(false), [source, version]);

	useEffect(() => {
		renderedVersion = source;
		// The committed classes take over from a handle's preview
		clearPreview();
		hideOverlay();
		post({ type: "rendered" });
		scheduleMeasure();
	}, [source, version]);

	return children;
}

function isComponent(value: unknown): value is ComponentType {
	return typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value);
}

let screen: ComponentType | null = null;

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
	screen = Screen;
	textEdit?.finish(false);
	mountScreen();
}

function mountScreen() {
	const Screen = screen;

	if (!Screen) return;
	root.render(
		<Boundary key={mount} version={version}>
			<Rendered source={sourceVersion(registry.source(entry) ?? "")} version={version}>
				<Screen />
			</Rendered>
		</Boundary>,
	);
}

let renderPending = false;

let iconsLoading: Promise<void> | null = null;

/** Waits for the screen's icons, so they paint with the first render. */
function requestRender(icons: Promise<void> | null) {
	renderPending = true;

	if (icons) iconsLoading = iconsLoading ? Promise.all([iconsLoading, icons]).then(() => {}) : icons;
	const waiting = iconsLoading;

	if (!waiting) return flushRender();
	void waiting.then(() => {
		if (iconsLoading !== waiting) return;
		iconsLoading = null;
		flushRender();
	});
}

function flushRender() {
	if (!renderPending) return;
	renderPending = false;
	render();
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
							boxes: hit.indices.slice(0, 1).map((i) => boxOf(located[i]!.elements)),
						}
					: null,
		});
	} else if (message?.type === "drop-layout") {
		const { id, start, version: layoutVersion, x, y } = message;
		const layout = entry && layoutVersion === renderedVersion ? dropLayoutOf(rootElement, entry, start, x, y) : null;

		post({ type: "drop-layout", id, layout: layout && { ...layout, version: layoutVersion } });
	} else if (message?.type === "element-boxes") {
		const { id, start, version: boxesVersion } = message;

		const boxes =
			entry && boxesVersion === renderedVersion ? boxesOf(instancesOf(rootElement, locationOf(entry, start))) : null;

		post({ type: "element-boxes", id, boxes });
	} else if (message?.type === "track") {
		tracked = message.start === null ? null : { start: message.start, version: message.version, sent: "" };
		reportBoxes();
	} else if (message?.type === "preview-style") {
		if (message.style === null) {
			clearPreview();
			scheduleMeasure();
		} else if (entry && message.version === renderedVersion) previewStyle(message.start, message.style);
	} else if (message?.type === "preview-order") {
		if (message.preview === null) clearOrder(true);
		else if (entry && message.version === renderedVersion)
			previewOrder(instancesOf(rootElement, locationOf(entry, message.start)), message.preview);
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

				const image = raster
					? await rasterize(
							raster.maxHeight ? { ...scene, height: Math.min(scene.height, raster.maxHeight) } : scene,
							raster,
						)
					: undefined;

				post(
					image
						? { type: "snapshot", id, scene, raster: { dataUrl: image.dataUrl, scale: image.scale } }
						: { type: "snapshot", id, scene },
				);
			} catch (error) {
				post({ type: "snapshot", id, error: error instanceof Error ? error.message : String(error) });
			}
		})();
	} else if (message?.type === "lint") {
		const { id } = message;
		void (async () => {
			try {
				await settle();
				post({ type: "lint", id, findings: entry && renderedVersion ? lintScreen(rootElement) : [] });
			} catch (error) {
				post({ type: "lint", id, error: error instanceof Error ? error.message : String(error) });
			}
		})();
	} else if (message?.type === "play") {
		play.set(message.on === true);
	} else if (message?.type === "pause") {
		setPaused(message.on === true);
	} else if (message?.type === "assets") {
		if (!frameAssets.apply(message.assets, message.reset)) return;
		style.textContent = frameAssets.css(css);

		// Props are resolved while rendering, so the screen renders again with the new URLs
		if (entry && registry.isLoaded(entry)) requestRender(null);
	} else if (message?.type === "css") {
		setCss(message.css);
	} else if (message?.type === "theme") {
		themeStyle.textContent = message.css;
	} else if (message?.type === "modules") {
		if (message.css !== undefined) setCss(message.css);

		if (message.theme !== undefined) themeStyle.textContent = message.theme;
		const invalid = registry.apply(message.modules, message.reset);
		const entryChanged = message.entry !== entry;

		// Play mode navigates within one frame, so reset scroll on screen change
		if (entryChanged && entry) window.scrollTo(0, 0);
		entry = message.entry;
		const icons = preloadIcons(Object.values(message.modules).flatMap((payload) => payload?.icons ?? []));

		if (entryChanged || invalid.has(entry) || !registry.isLoaded(entry) || renderPending) requestRender(icons);
	}
});

window.addEventListener("error", (event) => reportError(event.error ?? event.message));

window.addEventListener("unhandledrejection", (event) => reportError(event.reason));

post({ type: "ready" });
