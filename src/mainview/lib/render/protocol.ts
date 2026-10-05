/** Messages between the host webview and the screen runtime inside each frame. */

import type { Scene } from "../../../shared/export/scene";
import { hashString } from "../../../shared/jsx/hash";

/** Where an error points to in project source. Lines and columns are 1-based. */
export type SourceLocation = { line: number; column?: number };

export type CompileError = SourceLocation & { message: string };

/** One project module as the frame receives it: compiled code, or the reason it did not compile. */
export type ModulePayload =
	| { code: string; source: string; error?: undefined }
	| { code?: undefined; source: string; error: CompileError };

/** Host → frame. `modules` holds only what changed since the last message; `null` deletes a module. */
export type HostMessage =
	| {
			type: "modules";
			entry: string;
			modules: Record<string, ModulePayload | null>;
			/** Present when the stylesheet changed */
			css?: string;
			/** Present when the DESIGN.md token overrides changed; loads after `css` */
			theme?: string;
			/** Drop everything the frame knew before this message */
			reset?: boolean;
	  }
	| { type: "css"; css: string }
	| { type: "theme"; css: string }
	/** Which source element is at frame-local CSS pixel `x`, `y`? Answered by a `hit` with the same `id`. */
	| { type: "hit-test"; id: number; x: number; y: number }
	/**
	 * Report the boxes of the entry element at `start` (in the entry source whose
	 * `sourceVersion` is `version`) in `boxes` messages, now and whenever the layout
	 * changes, until the next `track`. `start: null` stops.
	 */
	| { type: "track"; start: number | null; version: string }
	/**
	 * Edit the text of the entry element at `start` in place: the instance under
	 * `x`, `y` (or the first one), when its rendered text is `text`. Answered by
	 * `text-edit` messages.
	 */
	| { type: "edit-text"; start: number; version: string; text: string; x?: number; y?: number }
	/** Finish the text edit in progress: keep the text, or put the old one back */
	| { type: "end-edit"; commit: boolean }
	/**
	 * Play mode (decision 0007): clicks on elements with a `data-link-to` post
	 * `navigate` instead of their default; linked elements get a pointer cursor.
	 */
	| { type: "play"; on: boolean }
	/** Image export: the screen's content height. Answered by a `measured` with the same `id`. */
	| { type: "measure"; id: number }
	/**
	 * Image export: the rendered screen as a `Scene`, plus a PNG or JPEG of it
	 * when `raster` asks for one. Answered by a `snapshot` with the same `id`.
	 */
	| { type: "snapshot"; id: number; raster?: SnapshotRaster };

/** A raster image of a snapshot: `scale` device pixels per CSS pixel (lowered for very tall screens). */
export type SnapshotRaster = { type: "image/png" | "image/jpeg"; scale: number; quality?: number };

/** A render error, as the frame reports it. */
export type FrameError = {
	kind: "compile" | "runtime" | "missing-module";
	message: string;
	file?: string;
	line?: number;
	column?: number;
	/** Source lines around `line` */
	excerpt?: { line: number; text: string }[];
};

/** Frame → host. `size` reports the screen's content height in CSS pixels, on every change. */
export type FrameMessage =
	| { type: "ready" }
	| { type: "rendered" }
	| { type: "error"; error: FrameError }
	| { type: "size"; height: number }
	/** The entry screen's elements under a `hit-test` point, or `null` when none of its own are there */
	| { type: "hit"; id: number; hit: FrameHit | null }
	/** The tracked element's boxes, one per rendered instance (none when it doesn't render) */
	| { type: "boxes"; start: number; version: string; boxes: Box[] }
	/**
	 * A text edit started (`editing`), was refused because the element's DOM
	 * doesn't hold just its text (`refused`), or ended: `text` is the new text,
	 * or `null` when it was cancelled.
	 */
	| { type: "text-edit"; start: number; version: string; state: "editing" | "refused" }
	| { type: "text-edit"; start: number; version: string; state: "done"; text: string | null }
	/** Play mode: an element linking to `to` (its `data-link-to`, as written) was clicked */
	| { type: "navigate"; to: string }
	/** Play mode: Escape was pressed inside the frame and the screen didn't handle it */
	| { type: "escape" }
	/** Image export: the content height in CSS pixels */
	| { type: "measured"; id: number; height: number }
	/** Image export: the scene, the raster as a data URL when asked, or why it failed */
	| { type: "snapshot"; id: number; scene: Scene; raster?: { dataUrl: string; scale: number } }
	| { type: "snapshot"; id: number; error: string };

/** A rectangle in frame-local CSS pixels. */
export type Box = { x: number; y: number; width: number; height: number };

/**
 * Entry elements under a point. `starts` are start offsets in `path` (always
 * the entry): the element under the point, then its ancestors from the same
 * file. They are offsets into the entry source whose `sourceVersion` is
 * `version`: the one that rendered the DOM, which may be older than the file
 * when a newer version failed to load.
 */
export type FrameHit = {
	path: string;
	starts: number[];
	version: string;
	/** The box of the instance under the point, for each of `starts`; `null` when it has no size */
	boxes?: (Box | null)[];
};

/** Identifies one version of a source file across the host and the frames. */
export const sourceVersion = (source: string) => hashString(source);

/** Calls `post` with whole-pixel heights, and only when the height changed. */
export function heightReporter(post: (height: number) => void) {
	let last = -1;
	return (height: number) => {
		const rounded = Math.ceil(height);
		if (!Number.isFinite(rounded) || rounded < 0 || rounded === last) return;
		last = rounded;
		post(rounded);
	};
}

/** `sourceURL` prefix of every project module, so stack traces carry the file. */
export const SOURCE_URL_PREFIX = "rabisco://project/";

/** The attribute compiled DOM elements carry: `<path>:<start offset>` (see `injectLocations`). */
export const LOC_ATTRIBUTE = "data-rabisco-loc";

/**
 * The locations that belong to `entry`, from `data-rabisco-loc` values ordered
 * innermost first (the element under the pointer, then its ancestors), in that
 * order. Elements rendered by a component module are skipped, so a drop on a
 * card lands in the screen element that holds the card. `null` when there are none.
 */
export function resolveHit(values: Iterable<string | null>, entry: string): { path: string; starts: number[]; indices: number[] } | null {
	const prefix = `${entry}:`;
	const starts: number[] = [];
	/** Position of each start in `values`, so callers can pair them with what they found there */
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

/** The prototype link attribute (decision 0007); `LINK_ATTRIBUTE` in `src/shared/prototype/links.ts`. */
export const LINK_TO_ATTRIBUTE = "data-link-to";

/** `data-rabisco-loc` value of the entry element at `start`. */
export const locationOf = (entry: string, start: number) => `${entry}:${start}`;

const isBox = (box: unknown): box is Box =>
	!!box && typeof box === "object" && (["x", "y", "width", "height"] as const).every((key) => Number.isFinite((box as Box)[key]));

/** `boxes` from a frame, or `null` when any of them isn't a box. */
export const validBoxes = (boxes: unknown): Box[] | null => (Array.isArray(boxes) && boxes.every(isBox) ? boxes : null);

/** Hit boxes from a frame, aligned with `count` starts; missing or malformed entries become `null`. */
export function hitBoxes(boxes: unknown, count: number): (Box | null)[] {
	const list = Array.isArray(boxes) ? boxes : [];
	return Array.from({ length: count }, (_, i) => (isBox(list[i]) ? list[i] : null));
}
