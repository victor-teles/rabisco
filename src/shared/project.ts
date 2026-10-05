import type { ScreenMeta } from "./ai/contract";
import { detachComments } from "./comments";
import type { CanvasDoc, Device, Frame, ProjectFiles, ProjectSummary, ScreenSource } from "./types";

export const FRAME_SIZE = {
	mobile: { width: 390, height: 844 },
	desktop: { width: 1280, height: 800 },
} as const satisfies Record<Device, { width: number; height: number }>;

export const FRAME_GAP = 120;

/** `screens/<kebab>.tsx`, including alternates (`welcome.alt-1.tsx`). */
export const isScreenFile = (path: string) => /^screens\/[a-z0-9][a-z0-9-]*(\.alt-\d+)?\.tsx$/.test(path);

export const isComponentFile = (path: string) => /^components\/[a-z0-9][a-z0-9-]*\.tsx$/.test(path);

export function toKebab(text: string) {
	return (
		text
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "screen"
	);
}

/** `screens/order-history.tsx` → `Order history` */
export function screenNameFromPath(path: string) {
	const base = path.split("/").pop()!.replace(/\.tsx$/, "").replace(/\.alt-(\d+)$/, " (alt $1)");
	const words = base.replace(/-/g, " ");
	return words[0]!.toUpperCase() + words.slice(1);
}

/** A frame name for `path`: alternates get their number, `Welcome` → `Welcome (alt 2)`. */
export function frameName(name: string, path: string) {
	const alt = /\.alt-(\d+)\.tsx$/.exec(path);
	return alt && !name.endsWith(`(alt ${alt[1]})`) ? `${name} (alt ${alt[1]})` : name;
}

/** A free `screens/<kebab>.tsx` path for `name`, avoiding `taken`. */
export function uniqueScreenPath(name: string, taken: Iterable<string>) {
	const used = new Set(taken);
	const base = toKebab(name);
	let path = `screens/${base}.tsx`;
	for (let n = 2; used.has(path); n++) path = `screens/${base}-${n}.tsx`;
	return path;
}

/** x for the next frame placed to the right of everything on the canvas. */
export function nextFrameX(frames: Frame[]) {
	if (!frames.length) return 0;
	return Math.max(...frames.map((f) => f.x + f.width)) + FRAME_GAP * 2;
}

/**
 * Frames for screens a generation created, left to right from the canvas origin
 * in the order they were written; the editor offsets them. `meta` comes from `file.start`.
 */
export function framesForNewScreens(paths: string[], meta: Record<string, ScreenMeta | undefined>, device: Device): Frame[] {
	let x = 0;
	return paths.filter(isScreenFile).map((file) => {
		const frameDevice = meta[file]?.device ?? device;
		const size = FRAME_SIZE[frameDevice];
		const frame = { file, name: frameName(meta[file]?.name?.trim() || screenNameFromPath(file), file), device: frameDevice, x, y: 0, ...size };
		x += size.width + FRAME_GAP;
		return frame;
	});
}

/**
 * Makes the canvas match the files on disk: drops frames whose screen file is
 * gone and adds a frame for every screen file that has none. Pins on a dropped
 * frame stay where they were, on the canvas (`detachComments`).
 */
export function reconcileFrames(canvas: CanvasDoc, files: ProjectFiles): CanvasDoc {
	const kept = canvas.frames.filter((frame) => frame.file in files);
	const placed = new Set(kept.map((frame) => frame.file));
	const frames = [...kept];
	for (const path of Object.keys(files).sort()) {
		if (!isScreenFile(path) || placed.has(path)) continue;
		const size = FRAME_SIZE[canvas.device];
		// An alternate goes below the other frames of its screen (decision 0004)
		const base = path.replace(/\.alt-\d+\.tsx$/, ".tsx");
		const group = frames.filter((frame) => frame.file.replace(/\.alt-\d+\.tsx$/, ".tsx") === base);
		const x = group.length ? (group.find((frame) => frame.file === base) ?? group[0]!).x : nextFrameX(frames);
		const y = group.length ? Math.max(...group.map((frame) => frame.y + frame.height)) + FRAME_GAP : 0;
		frames.push({ file: path, name: screenNameFromPath(path), device: canvas.device, x, y, ...size });
	}
	if (frames.length === canvas.frames.length && kept.length === canvas.frames.length) return canvas;
	return {
		...canvas,
		frames,
		selection: canvas.selection.filter((file) => file in files),
		...(canvas.comments ? { comments: detachComments(canvas.comments, canvas.frames, kept) } : {}),
	};
}

export function emptyCanvas(name: string, device: Device): CanvasDoc {
	const now = new Date().toISOString();
	return { version: 1, name, device, createdAt: now, updatedAt: now, frames: [], selection: [], alternates: [], comments: [] };
}

export const isContextFile = (path: string) => path === "PRODUCT.md" || path === "DESIGN.md";

/** Files that belong in `Project.files`: screens, components and the context Markdown. */
export const isProjectFile = (path: string) => isScreenFile(path) || isComponentFile(path) || isContextFile(path);

/** `~/Documents/Rabisco/my-app.rabisco` → `my-app` */
export function projectNameFromPath(path: string) {
	const base = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Untitled";
	return base.replace(/\.rabisco$/i, "") || "Untitled";
}

/**
 * First frame of the canvas with everything it needs to render on its own: its screen file,
 * every component, and DESIGN.md for the theme tokens.
 */
export function coverFor(canvas: CanvasDoc, files: ProjectFiles): ScreenSource | null {
	const frame = canvas.frames.find((f) => f.file in files);
	if (!frame) return null;
	const coverFiles: ProjectFiles = { [frame.file]: files[frame.file]! };
	for (const [path, content] of Object.entries(files)) if (isComponentFile(path) || path === "DESIGN.md") coverFiles[path] = content;
	return { entry: frame.file, device: frame.device, width: frame.width, height: frame.height, files: coverFiles };
}

export function summarizeProject(path: string, canvas: CanvasDoc, files: ProjectFiles): ProjectSummary {
	return {
		path,
		name: canvas.name,
		device: canvas.device,
		updatedAt: canvas.updatedAt,
		screenCount: canvas.frames.length,
		cover: coverFor(canvas, files),
		missing: false,
	};
}
