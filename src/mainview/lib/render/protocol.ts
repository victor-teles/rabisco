import { DESIGN_RULES, type DesignFinding } from "../../../shared/design/findings";
import type { Scene } from "../../../shared/export/scene";
import { isNumber, isString } from "../../../shared/guards";
import { hashString } from "../../../shared/jsx/hash";
import type { ElementLayout, Spacing } from "./spacing";

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
			/** DESIGN.md token overrides; loads after `css`. */
			theme?: string;
			/** Drop everything the frame knew before this message. */
			reset?: boolean;
	  }
	| { type: "css"; css: string }
	/** Project images by `src` (decision 0010); only what changed unless `reset`. `null` deletes. */
	| { type: "assets"; assets: Record<string, AssetPayload | null>; reset?: boolean }
	| { type: "theme"; css: string }
	/** Answered by a `hit` with the same `id`; `x`, `y` are frame-local CSS pixels. */
	| { type: "hit-test"; id: number; x: number; y: number }
	/** Answered by a `drop-layout` with the same `id`; `x`, `y` pick the instance under the pointer (else the first). */
	| { type: "drop-layout"; id: number; start: number; version: string; x: number; y: number }
	/** Answered by an `element-boxes` with the same `id`: where the element at `start` renders, without tracking it. */
	| { type: "element-boxes"; id: number; start: number; version: string }
	/** Stream `boxes` for the element at `start` on every layout change until the next `track`; `null` stops. */
	| { type: "track"; start: number | null; version: string }
	/** Inline styles on every instance of the element at `start` while a handle drags; `null` (or the next render) restores them */
	| { type: "preview-style"; start: number; version: string; style: Record<string, string> | null }
	/** Shifts the instances of a dragged list item until the next render; `null` slides them back */
	| { type: "preview-order"; start: number; version: string; preview: OrderPreview | null }
	/** Inline-edit the instance under `x`, `y` (or the first) if its text is `text`; answered by `text-edit`. */
	| { type: "edit-text"; start: number; version: string; text: string; x?: number; y?: number }
	| { type: "end-edit"; commit: boolean }
	/** Play mode (decision 0007): `data-link-to` clicks post `navigate` instead of their default. */
	| { type: "play"; on: boolean }
	/** Offscreen: stop measuring and streaming boxes until resumed. */
	| { type: "pause"; on: boolean }
	/** Answered by a `measured` with the same `id`. */
	| { type: "measure"; id: number }
	/** Answered by a `snapshot` with the same `id`. */
	| { type: "snapshot"; id: number; raster?: SnapshotRaster }
	/** Answered by a `lint` with the same `id`: the design checks on the rendered screen. */
	| { type: "lint"; id: number };

/** The canvas posts Blobs, which share their bytes with the frame; the share viewer posts `data:` URLs. */
export type AssetPayload = Blob | string;

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
	/** One box per rendered instance; `spacing` and `layout` describe the first instance. */
	| {
			type: "boxes";
			start: number;
			version: string;
			boxes: Box[];
			spacing?: Spacing | null;
			layout?: ElementLayout | null;
	  }
	/** `refused` when the element's DOM doesn't hold just its text; `done` with `text: null` means cancelled. */
	| { type: "text-edit"; start: number; version: string; state: "editing" | "refused" }
	| { type: "text-edit"; start: number; version: string; state: "done"; text: string | null }
	| { type: "navigate"; to: string }
	/** Escape pressed in play mode and not handled by the screen. */
	| { type: "escape" }
	| { type: "measured"; id: number; height: number }
	| { type: "snapshot"; id: number; scene: Scene; raster?: { dataUrl: string; scale: number } }
	| { type: "snapshot"; id: number; error: string }
	| { type: "lint"; id: number; findings: DesignFinding[] }
	| { type: "lint"; id: number; error: string };

/** Frame-local CSS pixels. */
export type Box = { x: number; y: number; width: number; height: number };

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

function isFrameHit(hit: unknown): hit is FrameHit {
	if (!isObject(hit) || !("path" in hit) || !("starts" in hit) || !("version" in hit)) return false;
	const boxes = "boxes" in hit ? hit.boxes : undefined;

	return (
		isString(hit.path) &&
		isString(hit.version) &&
		Array.isArray(hit.starts) &&
		hit.starts.every(isNumber) &&
		(boxes === undefined || (Array.isArray(boxes) && boxes.every(isBoxOrNull)))
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
		(layout.parent === null || (isString(layout.parent) && AXES.includes(layout.parent)))
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
		case "boxes":
			return (
				isTracked(data) &&
				"boxes" in data &&
				isBoxList(data.boxes) &&
				(!("spacing" in data) || data.spacing === undefined || data.spacing === null || isSpacing(data.spacing)) &&
				(!("layout" in data) || data.layout === undefined || data.layout === null || isElementLayout(data.layout))
			);
		case "text-edit":
			if (!isTracked(data) || !("state" in data)) return false;

			if (data.state === "done") return "text" in data && (data.text === null || isString(data.text));

			return data.state === "editing" || data.state === "refused";
		case "navigate":
			return "to" in data && isString(data.to);
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
		case "lint":
			if (!hasId(data)) return false;

			if ("error" in data) return isString(data.error);

			return "findings" in data && Array.isArray(data.findings) && data.findings.every(isDesignFinding);
		default:
			return false;
	}
}

export function hitBoxes(boxes: (Box | null)[] | undefined, count: number): (Box | null)[] {
	return Array.from({ length: count }, (_, i) => boxes?.[i] ?? null);
}
