import type { Scene } from "../../../shared/export/scene";
import { isNumber, isString } from "../../../shared/guards";
import { hashString } from "../../../shared/jsx/hash";

/** Where an error points to in project source. Lines and columns are 1-based. */
export type SourceLocation = { line: number; column?: number };

export type CompileError = SourceLocation & { message: string };

export type ModulePayload =
	| { code: string; source: string; error?: undefined }
	| { code?: undefined; source: string; error: CompileError };

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
	| { type: "theme"; css: string }
	/** Answered by a `hit` with the same `id`; `x`, `y` are frame-local CSS pixels. */
	| { type: "hit-test"; id: number; x: number; y: number }
	/** Stream `boxes` for the element at `start` on every layout change until the next `track`; `null` stops. */
	| { type: "track"; start: number | null; version: string }
	/** Inline-edit the instance under `x`, `y` (or the first) if its text is `text`; answered by `text-edit`. */
	| { type: "edit-text"; start: number; version: string; text: string; x?: number; y?: number }
	| { type: "end-edit"; commit: boolean }
	/** Play mode (decision 0007): `data-link-to` clicks post `navigate` instead of their default. */
	| { type: "play"; on: boolean }
	/** Answered by a `measured` with the same `id`. */
	| { type: "measure"; id: number }
	/** Answered by a `snapshot` with the same `id`. */
	| { type: "snapshot"; id: number; raster?: SnapshotRaster };

/** `scale` is device pixels per CSS pixel (lowered for very tall screens). */
export type SnapshotRaster = { type: "image/png" | "image/jpeg"; scale: number; quality?: number };

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
	/** One box per rendered instance. */
	| { type: "boxes"; start: number; version: string; boxes: Box[] }
	/** `refused` when the element's DOM doesn't hold just its text; `done` with `text: null` means cancelled. */
	| { type: "text-edit"; start: number; version: string; state: "editing" | "refused" }
	| { type: "text-edit"; start: number; version: string; state: "done"; text: string | null }
	| { type: "navigate"; to: string }
	/** Escape pressed in play mode and not handled by the screen. */
	| { type: "escape" }
	| { type: "measured"; id: number; height: number }
	| { type: "snapshot"; id: number; scene: Scene; raster?: { dataUrl: string; scale: number } }
	| { type: "snapshot"; id: number; error: string };

/** Frame-local CSS pixels. */
export type Box = { x: number; y: number; width: number; height: number };

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
		case "boxes":
			return isTracked(data) && "boxes" in data && Array.isArray(data.boxes) && data.boxes.every(isBox);
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
		default:
			return false;
	}
}

export function hitBoxes(boxes: (Box | null)[] | undefined, count: number): (Box | null)[] {
	return Array.from({ length: count }, (_, i) => boxes?.[i] ?? null);
}
