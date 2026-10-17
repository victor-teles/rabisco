import type { BarSample, ControlSample, ScreenSample } from "../../../shared/design/consistency-checks";
import { DESIGN_RULES, type DesignFinding } from "../../../shared/design/findings";
import type { FontFile } from "../../../shared/export/figma/font";
import type { Scene } from "../../../shared/export/scene";
import { isNumber, isString } from "../../../shared/guards";
import { hashString } from "../../../shared/jsx/hash";
import type { RichRun } from "../../../shared/jsx/rich-text";
import type { ResolvedMode } from "../../../shared/modes";
import type { MotionKind } from "../../../shared/motion/presets";
import type { ElementLayout, Insets, Spacing } from "./spacing";

/** Where an error points to in project source. Lines and columns are 1-based. */
export type SourceLocation = { line: number; column?: number };

export type CompileError = SourceLocation & { message: string };

/** `icons` are the lucide-react imports, which the frame loads before rendering. */
export type ModulePayload =
	| { code: string; source: string; error?: undefined; icons?: string[] }
	| { code?: undefined; source: string; error: CompileError; icons?: undefined };

/** Host → frame. `modules` holds only what changed since the last message; `null` deletes a module. */
export type HostMessage =
	| {
			type: "modules";
			entry: string;
			modules: Record<string, ModulePayload | null>;
			css?: string;
			/** Appended after the frame's CSS; the next `css` replaces both. */
			cssPatch?: string;
			/** DESIGN.md token overrides; loads after `css`. */
			theme?: string;
			mode?: ResolvedMode;
			/** Drop everything the frame knew before this message. */
			reset?: boolean;
	  }
	| { type: "css"; css: string }
	/** Appended after the frame's CSS until the next `css` */
	| { type: "css-patch"; css: string }
	/** Project images by `src` (decision 0010); only what changed unless `reset`. `null` deletes. */
	| { type: "assets"; assets: Record<string, AssetPayload | null>; reset?: boolean }
	| { type: "theme"; css: string }
	| { type: "mode"; mode: ResolvedMode }
	/** Answered by a `hit` with the same `id`; `x`, `y` are frame-local CSS pixels. */
	| { type: "hit-test"; id: number; x: number; y: number }
	/** Answered by a `drop-layout` with the same `id`; `x`, `y` pick the instance under the pointer (else the first). */
	| { type: "drop-layout"; id: number; start: number; version: string; x: number; y: number }
	/** Answered by an `element-boxes` with the same `id`: where the element at `start` renders, without tracking it. */
	| { type: "element-boxes"; id: number; start: number; version: string; path?: string }
	/** Answered by a `placements` with the same `id`: where each element sits in its containing block. */
	| { type: "placements"; id: number; starts: number[]; version: string }
	/** Stream `boxes` for the element at `start` on every layout change until the next `track`; `null` stops. */
	| { type: "track"; start: number | null; version: string; path?: string }
	| { type: "links"; starts: number[]; version: string }
	/** Inline styles on every instance of the elements at `starts` while a handle drags; `null` (or the next render) restores them */
	| { type: "preview-style"; starts: number[]; version: string; style: Record<string, string> | null }
	/** Plays the elements' motion of one kind again: animations restart, hover and press play there and back */
	| { type: "replay-motion"; starts: number[]; version: string; kind: MotionKind }
	/** Shifts the instances of a dragged list item until the next render; `null` slides them back */
	| { type: "preview-order"; start: number; version: string; preview: OrderPreview | null }
	/** Inline-edit the instance under `x`, `y` (or the first) if its text is `text`; answered by `text-edit`. `rich` takes formatting tags. */
	| {
			type: "edit-text";
			start: number;
			version: string;
			text: string;
			rich?: boolean;
			x?: number;
			y?: number;
			path?: string;
	  }
	| { type: "end-edit"; commit: boolean }
	/** Play mode (decision 0007): `data-link-to` clicks post `navigate` instead of their default. */
	| { type: "play"; on: boolean }
	/** A key pressed in the play view while the frame doesn't have focus, for `key` link triggers (decision 0046) */
	| { type: "play-key"; key: string }
	/** Offscreen: stop measuring and streaming boxes until resumed. */
	| { type: "pause"; on: boolean }
	/** Answered by a `measured` with the same `id`. */
	| { type: "measure"; id: number }
	/** Answered by a `snapshot` with the same `id`; `starts` limits it to the first instance of those elements. */
	| { type: "snapshot"; id: number; raster?: SnapshotRaster; starts?: number[] }
	| { type: "figma-capture"; id: number; fonts: FontFile[] }
	/** Answered by a `lint` with the same `id`: the design checks on the rendered screen, or with `accessibility` those instead */
	| { type: "lint"; id: number; accessibility?: { touch: boolean } }
	/** Answered by a `sample` with the same `id`: what the consistency check compares across screens */
	| { type: "sample"; id: number }
	/** Answered by a `markup` with the same `id`: the rendered HTML, with project images at their own paths. */
	| { type: "markup"; id: number }
	| { type: "pick-color"; id: number; x: number; y: number }
	/** The share viewer (decision 0038): a tap inspects an element or picks a point instead of reaching the screen. `null` ends it */
	| { type: "pick-mode"; mode: PickMode | null }
	/** Comment pins, in screen coordinates */
	| { type: "pins"; pins: { x: number; y: number }[] };

export type PickMode = "inspect" | "point";

export type InspectedColor = { role: "fill" | "text" | "border"; hex: string; alpha: number; token: string | null };

/** CSS pixels of the first rendered element; `font` only when it holds text */
export type InspectedElement = {
	start: number;
	width: number;
	height: number;
	padding: Insets;
	margin: Insets;
	gap: { row: number; column: number } | null;
	radius: [number, number, number, number];
	font: { family: string; size: number; weight: string; lineHeight: number | null } | null;
	colors: InspectedColor[];
	opacity: number;
};

/** The canvas posts Blobs, which share their bytes with the frame; the share viewer posts `data:` URLs. */
export type AssetPayload = Blob | string;

export type FrameImage = { bytes: Uint8Array; width: number; height: number };

/** `scale` is device pixels per CSS pixel (lowered for very tall screens). */
export type SnapshotRaster = {
	type: "image/png" | "image/jpeg";
	scale: number;
	quality?: number;
	/** Crops the image (not the scene) to this many CSS pixels from the top. */
	maxHeight?: number;
};

export type FrameError = {
	kind: "compile" | "runtime" | "missing-module";
	message: string;
	file?: string;
	line?: number;
	column?: number;
	excerpt?: { line: number; text: string }[];
};

/** Frame → host. */
export type FrameMessage =
	| { type: "ready" }
	| { type: "rendered" }
	| { type: "error"; error: FrameError }
	| { type: "size"; height: number }
	| { type: "hit"; id: number; hit: FrameHit | null }
	/** `null` when `version` isn't the rendered one or the element isn't rendered. */
	| { type: "drop-layout"; id: number; layout: DropLayout | null }
	/** `null` when `version` isn't the rendered one. */
	| { type: "element-boxes"; id: number; boxes: Box[] | null }
	/** In the order asked; `null` when `version` isn't the rendered one or an element isn't rendered. */
	| { type: "placements"; id: number; placements: Placement[] | null }
	/** One box per rendered instance; `spacing` and `layout` describe the first instance. */
	| {
			type: "boxes";
			start: number;
			version: string;
			boxes: Box[];
			spacing?: Spacing | null;
			layout?: ElementLayout | null;
	  }
	| { type: "link-boxes"; version: string; width: number; links: LinkBox[] }
	/** `refused` when the element's DOM doesn't hold just its text; `done` with `text: null` means cancelled. */
	| { type: "text-edit"; start: number; version: string; state: "editing" | "refused" }
	| { type: "text-edit"; start: number; version: string; state: "done"; text: string | null; runs?: RichRun[] | null }
	| ({ type: "navigate"; to: string } & LinkOptions)
	/** Escape pressed in play mode and not handled by the screen. */
	| { type: "escape" }
	| { type: "contextmenu"; x: number; y: number; metaKey: boolean }
	| { type: "measured"; id: number; height: number }
	| { type: "snapshot"; id: number; scene: Scene; raster?: { dataUrl: string; scale: number } }
	| { type: "snapshot"; id: number; error: string }
	| { type: "figma-capture"; id: number; tree: string; images: Record<string, FrameImage> }
	| { type: "figma-capture"; id: number; error: string }
	| { type: "lint"; id: number; findings: DesignFinding[] }
	| { type: "lint"; id: number; error: string }
	| { type: "sample"; id: number; sample: ScreenSample }
	| { type: "sample"; id: number; error: string }
	| { type: "markup"; id: number; html: string }
	| { type: "markup"; id: number; error: string }
	| { type: "picked-color"; id: number; color: string | null }
	| { type: "inspected"; element: InspectedElement | null }
	/** `x`, `y` in screen coordinates (scroll included); `clientX`, `clientY` in the frame's viewport */
	| { type: "pointed"; x: number; y: number; clientX: number; clientY: number };

/** Frame-local CSS pixels. */
export type Box = { x: number; y: number; width: number; height: number };

/** `box` is the first instance's border box from its containing block's padding edge, `container` that block's padding box. */
export type Placement = { box: Box; margin: { x: number; y: number }; container: { width: number; height: number } };

export type LinkBox = { start: number; box: Box };

/** Frame-local CSS pixels. `children` are the container's direct children from the entry file, in DOM order; an element rendered by `.map` reports one entry per instance, all with the same `start`. */
export type DropLayout = {
	start: number;
	version: string;
	box: Box;
	/** Computed style of the element that lays out the children (the container's own element, or for a component usage like `<Card>`, the DOM parent of its first child) */
	display: string;
	flexDirection: string;
	flexWrap: string;
	gridAutoFlow: string;
	/** Number of tracks in grid-template-columns; 0 when not a grid */
	gridColumns: number;
	/** `direction` CSS property (ltr/rtl) */
	direction: string;
	children: { start: number; box: Box }[];
};

/**
 * Slot `i` shows instance `order[i]`. The instance nearest `box` (frame-local) is the dragged one: it follows `offset`,
 * or settles into its slot when `offset` is `null`.
 */
export type OrderPreview = { order: number[]; box: Box; offset: { x: number; y: number } | null };

/** `starts` are innermost-first offsets into the entry source at `version`, which may be older than the file. */
export type FrameHit = {
	path: string;
	starts: number[];
	version: string;
	boxes?: (Box | null)[];
	inner?: { loc: string; version: string }[];
};

export const sourceVersion = (source: string) => hashString(source);

export function heightReporter(post: (height: number) => void) {
	let last = -1;

	return (height: number) => {
		const rounded = Math.ceil(height);

		if (!Number.isFinite(rounded) || rounded < 0 || rounded === last) return;
		last = rounded;
		post(rounded);
	};
}

export const SOURCE_URL_PREFIX = "rabisco://project/";

/** Value is `<path>:<start offset>` (see `injectLocations`). */
export const LOC_ATTRIBUTE = "data-rabisco-loc";

/** Skips elements rendered by component modules, so a drop on a card lands in the screen element holding it. */
export function resolveHit(
	values: Iterable<string | null>,
	entry: string,
): { path: string; starts: number[]; indices: number[] } | null {
	const prefix = `${entry}:`;
	const starts: number[] = [];
	const indices: number[] = [];
	let index = -1;

	for (const value of values) {
		index++;

		if (!value?.startsWith(prefix)) continue;
		const start = Number(value.slice(prefix.length));

		if (Number.isInteger(start) && start >= 0 && !starts.includes(start)) {
			starts.push(start);
			indices.push(index);
		}
	}

	return starts.length ? { path: entry, starts, indices } : null;
}

/** Mirrors `LINK_ATTRIBUTE` in `src/shared/prototype/links.ts` (decision 0007). */
export const LINK_TO_ATTRIBUTE = "data-link-to";

export const LINK_TRANSITION_ATTRIBUTE = "data-link-transition";

export const LINK_MODE_ATTRIBUTE = "data-link-mode";

export const LINK_DURATION_ATTRIBUTE = "data-link-duration";

export const LINK_EASING_ATTRIBUTE = "data-link-easing";

export const LINK_TRIGGER_ATTRIBUTE = "data-link-trigger";

/** As written; the host parses them (decisions 0022, 0046) */
export type LinkOptions = { transition?: string; mode?: string; duration?: string; easing?: string };

export const locationOf = (entry: string, start: number) => `${entry}:${start}`;

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

const hasId = (value: unknown): value is { id: number } => isObject(value) && "id" in value && isNumber(value.id);

function isBox(box: unknown): box is Box {
	return (
		isObject(box) &&
		"x" in box &&
		"y" in box &&
		"width" in box &&
		"height" in box &&
		[box.x, box.y, box.width, box.height].every((n) => Number.isFinite(n))
	);
}

const isBoxOrNull = (box: unknown): box is Box | null => box === null || isBox(box);

const isInnerHit = (item: unknown): item is { loc: string; version: string } =>
	isObject(item) && "loc" in item && "version" in item && isString(item.loc) && isString(item.version);

function isFrameHit(hit: unknown): hit is FrameHit {
	if (!isObject(hit) || !("path" in hit) || !("starts" in hit) || !("version" in hit)) return false;
	const boxes = "boxes" in hit ? hit.boxes : undefined;
	const inner = "inner" in hit ? hit.inner : undefined;

	return (
		isString(hit.path) &&
		isString(hit.version) &&
		Array.isArray(hit.starts) &&
		hit.starts.every(isNumber) &&
		(boxes === undefined || (Array.isArray(boxes) && boxes.every(isBoxOrNull))) &&
		(inner === undefined || (Array.isArray(inner) && inner.every(isInnerHit)))
	);
}

const FRAME_ERROR_KINDS: readonly string[] = ["compile", "runtime", "missing-module"] satisfies FrameError["kind"][];

function isFrameError(error: unknown): error is FrameError {
	return (
		isObject(error) &&
		"kind" in error &&
		"message" in error &&
		isString(error.kind) &&
		FRAME_ERROR_KINDS.includes(error.kind) &&
		isString(error.message)
	);
}

function isScene(scene: unknown): scene is Scene {
	return (
		isObject(scene) &&
		"ops" in scene &&
		"width" in scene &&
		"height" in scene &&
		Array.isArray(scene.ops) &&
		Number.isFinite(scene.width) &&
		Number.isFinite(scene.height)
	);
}

function isRaster(raster: unknown): raster is { dataUrl: string; scale: number } {
	return (
		isObject(raster) && "dataUrl" in raster && "scale" in raster && isString(raster.dataUrl) && isNumber(raster.scale)
	);
}

const isFrameImage = (image: unknown): image is FrameImage =>
	isObject(image) &&
	"bytes" in image &&
	"width" in image &&
	"height" in image &&
	image.bytes instanceof Uint8Array &&
	isNumber(image.width) &&
	isNumber(image.height);

const isFrameImages = (images: unknown): images is Record<string, FrameImage> =>
	isObject(images) && Object.entries(images).every(([key, image]) => /^#image-\d+$/.test(key) && isFrameImage(image));

const isTracked = (value: unknown): value is { start: number; version: string } =>
	isObject(value) && "start" in value && "version" in value && isNumber(value.start) && isString(value.version);

const isDropChild = (child: unknown): child is { start: number; box: Box } =>
	isObject(child) && "start" in child && "box" in child && isNumber(child.start) && isBox(child.box);

function isDropLayout(layout: unknown): layout is DropLayout {
	if (
		!isTracked(layout) ||
		!("box" in layout && "children" in layout && "gridColumns" in layout) ||
		!("display" in layout && "flexDirection" in layout && "flexWrap" in layout) ||
		!("gridAutoFlow" in layout && "direction" in layout)
	)
		return false;

	return (
		isBox(layout.box) &&
		isNumber(layout.gridColumns) &&
		[layout.display, layout.flexDirection, layout.flexWrap, layout.gridAutoFlow, layout.direction].every(isString) &&
		Array.isArray(layout.children) &&
		layout.children.every(isDropChild)
	);
}

const isBoxList = (boxes: unknown): boxes is Box[] => Array.isArray(boxes) && boxes.every(isBox);

const isPlacement = (placement: unknown): placement is Placement =>
	isObject(placement) &&
	"box" in placement &&
	"margin" in placement &&
	"container" in placement &&
	isBox(placement.box) &&
	isObject(placement.margin) &&
	"x" in placement.margin &&
	"y" in placement.margin &&
	isNumber(placement.margin.x) &&
	isNumber(placement.margin.y) &&
	isObject(placement.container) &&
	"width" in placement.container &&
	"height" in placement.container &&
	isNumber(placement.container.width) &&
	isNumber(placement.container.height);

const isRichRun = (run: unknown): run is RichRun =>
	isObject(run) &&
	"text" in run &&
	isString(run.text) &&
	(!("bold" in run) || run.bold === undefined || run.bold === true) &&
	(!("italic" in run) || run.italic === undefined || run.italic === true) &&
	(!("href" in run) || run.href === undefined || isString(run.href));

const isRichRuns = (runs: unknown): runs is RichRun[] => Array.isArray(runs) && runs.every(isRichRun);

const isLinkBox = (link: unknown): link is LinkBox =>
	isObject(link) && "start" in link && "box" in link && isOffset(link.start) && isBox(link.box);

function isSpacing(spacing: unknown): spacing is Spacing {
	return (
		isObject(spacing) &&
		"padding" in spacing &&
		"gaps" in spacing &&
		isBoxList(spacing.padding) &&
		isBoxList(spacing.gaps)
	);
}

const isInsets = (insets: unknown): insets is ElementLayout["padding"] =>
	isObject(insets) &&
	"top" in insets &&
	"right" in insets &&
	"bottom" in insets &&
	"left" in insets &&
	[insets.top, insets.right, insets.bottom, insets.left].every((n) => Number.isFinite(n));

const AXES: readonly (string | null)[] = ["row", "column", null];

function isElementLayout(layout: unknown): layout is ElementLayout {
	if (!isObject(layout) || !("padding" in layout && "gap" in layout && "flow" in layout && "parent" in layout))
		return false;
	const { gap } = layout;

	return (
		isInsets(layout.padding) &&
		isObject(gap) &&
		"row" in gap &&
		"column" in gap &&
		Number.isFinite(gap.row) &&
		Number.isFinite(gap.column) &&
		(layout.flow === "grid" || layout.flow === null || (isString(layout.flow) && AXES.includes(layout.flow))) &&
		(layout.parent === null || (isString(layout.parent) && AXES.includes(layout.parent))) &&
		"stretched" in layout &&
		typeof layout.stretched === "boolean"
	);
}

const FILLS: readonly string[] = ["filled", "outline", "plain"] satisfies ControlSample["fill"][];

const PLACEMENTS: readonly string[] = ["top", "bottom", "left", "right", "inline"] satisfies BarSample["placement"][];

const isSize = (value: unknown): value is number => isNumber(value) && Number.isFinite(value) && value >= 0;

function isControlSample(control: unknown): control is ControlSample {
	return (
		isObject(control) &&
		(!("path" in control) || isString(control.path)) &&
		(!("start" in control) || isOffset(control.start)) &&
		"kind" in control &&
		(control.kind === "button" || control.kind === "input") &&
		"fill" in control &&
		isString(control.fill) &&
		FILLS.includes(control.fill) &&
		"text" in control &&
		isString(control.text) &&
		"height" in control &&
		isSize(control.height) &&
		"radius" in control &&
		isSize(control.radius) &&
		"fontSize" in control &&
		isSize(control.fontSize) &&
		"slot" in control &&
		(control.slot === null || isString(control.slot))
	);
}

function isBarSample(bar: unknown): bar is BarSample {
	return (
		isObject(bar) &&
		(!("path" in bar) || isString(bar.path)) &&
		(!("start" in bar) || isOffset(bar.start)) &&
		"kind" in bar &&
		(bar.kind === "nav" || bar.kind === "header") &&
		"placement" in bar &&
		isString(bar.placement) &&
		PLACEMENTS.includes(bar.placement) &&
		"size" in bar &&
		isSize(bar.size) &&
		"items" in bar &&
		Array.isArray(bar.items) &&
		bar.items.every(isString)
	);
}

function isScreenSample(sample: unknown): sample is ScreenSample {
	return (
		isObject(sample) &&
		"width" in sample &&
		isSize(sample.width) &&
		"inset" in sample &&
		(sample.inset === null || isNumber(sample.inset)) &&
		"controls" in sample &&
		Array.isArray(sample.controls) &&
		sample.controls.every(isControlSample) &&
		"bars" in sample &&
		Array.isArray(sample.bars) &&
		sample.bars.every(isBarSample)
	);
}

const RULES: readonly string[] = DESIGN_RULES;

const SEVERITIES: readonly string[] = ["error", "warning"] satisfies DesignFinding["severity"][];

const isOffset = (value: unknown): value is number => isNumber(value) && Number.isInteger(value) && value >= 0;

function isDesignFinding(finding: unknown): finding is DesignFinding {
	if (!isObject(finding) || !("rule" in finding && "severity" in finding && "message" in finding)) return false;
	const path = "path" in finding ? finding.path : undefined;
	const start = "start" in finding ? finding.start : undefined;
	const line = "line" in finding ? finding.line : undefined;

	return (
		isString(finding.rule) &&
		RULES.includes(finding.rule) &&
		isString(finding.severity) &&
		SEVERITIES.includes(finding.severity) &&
		isString(finding.message) &&
		(path === undefined || isString(path)) &&
		(start === undefined || isOffset(start)) &&
		(line === undefined || (isOffset(line) && line > 0))
	);
}

/** Frames run project code, so their messages are validated before the host acts on them. */
export function isFrameMessage(data: unknown): data is FrameMessage {
	if (!isObject(data) || !("type" in data)) return false;

	switch (data.type) {
		case "ready":
		case "rendered":
		case "escape":
			return true;
		case "error":
			return "error" in data && isFrameError(data.error);
		case "size":
			return "height" in data && isNumber(data.height);
		case "hit":
			return hasId(data) && "hit" in data && (data.hit === null || isFrameHit(data.hit));
		case "drop-layout":
			return hasId(data) && "layout" in data && (data.layout === null || isDropLayout(data.layout));
		case "element-boxes":
			return hasId(data) && "boxes" in data && (data.boxes === null || isBoxList(data.boxes));
		case "placements":
			return (
				hasId(data) &&
				"placements" in data &&
				(data.placements === null || (Array.isArray(data.placements) && data.placements.every(isPlacement)))
			);
		case "boxes":
			return (
				isTracked(data) &&
				"boxes" in data &&
				isBoxList(data.boxes) &&
				(!("spacing" in data) || data.spacing === undefined || data.spacing === null || isSpacing(data.spacing)) &&
				(!("layout" in data) || data.layout === undefined || data.layout === null || isElementLayout(data.layout))
			);
		case "link-boxes":
			return (
				"version" in data &&
				"width" in data &&
				"links" in data &&
				isString(data.version) &&
				isNumber(data.width) &&
				Array.isArray(data.links) &&
				data.links.every(isLinkBox)
			);
		case "text-edit":
			if (!isTracked(data) || !("state" in data)) return false;

			if (data.state === "done")
				return (
					"text" in data &&
					(data.text === null || isString(data.text)) &&
					(!("runs" in data) || data.runs === null || data.runs === undefined || isRichRuns(data.runs))
				);

			return data.state === "editing" || data.state === "refused";
		case "navigate":
			return (
				"to" in data &&
				isString(data.to) &&
				(!("transition" in data) || data.transition === undefined || isString(data.transition)) &&
				(!("mode" in data) || data.mode === undefined || isString(data.mode)) &&
				(!("duration" in data) || data.duration === undefined || isString(data.duration)) &&
				(!("easing" in data) || data.easing === undefined || isString(data.easing))
			);
		case "contextmenu":
			return (
				"x" in data &&
				isNumber(data.x) &&
				"y" in data &&
				isNumber(data.y) &&
				"metaKey" in data &&
				typeof data.metaKey === "boolean"
			);
		case "measured":
			return hasId(data) && "height" in data && isNumber(data.height);
		case "snapshot":
			if (!hasId(data)) return false;

			if ("error" in data) return isString(data.error);

			return (
				"scene" in data &&
				isScene(data.scene) &&
				(!("raster" in data) || data.raster === undefined || isRaster(data.raster))
			);
		case "figma-capture":
			if (!hasId(data)) return false;

			if ("error" in data) return isString(data.error);

			return "tree" in data && isString(data.tree) && "images" in data && isFrameImages(data.images);
		case "lint":
			if (!hasId(data)) return false;

			if ("error" in data) return isString(data.error);

			return "findings" in data && Array.isArray(data.findings) && data.findings.every(isDesignFinding);
		case "sample":
			if (!hasId(data)) return false;

			if ("error" in data) return isString(data.error);

			return "sample" in data && isScreenSample(data.sample);
		case "markup":
			if (!hasId(data)) return false;

			if ("error" in data) return isString(data.error);

			return "html" in data && isString(data.html);
		case "picked-color":
			return hasId(data) && "color" in data && (data.color === null || isString(data.color));
		default:
			return false;
	}
}

export function hitBoxes(boxes: (Box | null)[] | undefined, count: number): (Box | null)[] {
	return Array.from({ length: count }, (_, i) => boxes?.[i] ?? null);
}
