import type { ScreenMeta } from "./ai/contract";
import { detachComments } from "./comments";
import type { AppliedTheme } from "./context/theme";
import { designTokensOf } from "./context/tokens";
import type { CanvasDoc, Device, Frame, ProjectFiles, ProjectSummary, ScreenCover, ScreenSource } from "./types";

export const FRAME_SIZE = {
	mobile: { width: 390, height: 844 },
	desktop: { width: 1280, height: 800 },
} as const satisfies Record<Device, { width: number; height: number }>;

export const FRAME_GAP = 120;

/** Includes alternates (`welcome.alt-1.tsx`) */
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
	const base = path
		.split("/")
		.pop()!
		.replace(/\.tsx$/, "")
		.replace(/\.alt-(\d+)$/, " (alt $1)");

	const words = base.replace(/-/g, " ");

	return words[0]!.toUpperCase() + words.slice(1);
}

/** Alternates get their number: `Welcome (alt 2)` */
export function frameName(name: string, path: string) {
	const alt = /\.alt-(\d+)\.tsx$/.exec(path);

	return alt && !name.endsWith(`(alt ${alt[1]})`) ? `${name} (alt ${alt[1]})` : name;
}

export function uniqueScreenPath(name: string, taken: Iterable<string>) {
	const used = new Set(taken);
	const base = toKebab(name);
	let path = `screens/${base}.tsx`;

	for (let n = 2; used.has(path); n++) path = `screens/${base}-${n}.tsx`;

	return path;
}

export function nextFrameX(frames: Frame[]) {
	if (!frames.length) return 0;

	return Math.max(...frames.map((f) => f.x + f.width)) + FRAME_GAP * 2;
}

/** Left to right from the canvas origin; the editor offsets them. */
export function framesForNewScreens(
	paths: string[],
	meta: Record<string, ScreenMeta | undefined>,
	device: Device,
): Frame[] {
	const frames: Frame[] = [];
	let x = 0;

	for (const file of paths) {
		if (!isScreenFile(file)) continue;
		const frameDevice = meta[file]?.device ?? device;
		const size = FRAME_SIZE[frameDevice];

		frames.push({
			file,
			name: frameName(meta[file]?.name?.trim() || screenNameFromPath(file), file),
			device: frameDevice,
			x,
			y: 0,
			...size,
		});
		x += size.width + FRAME_GAP;
	}

	return frames;
}

/** Pins on a dropped frame stay where they were, on the canvas. */
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

	const next: CanvasDoc = { ...canvas, frames, selection: canvas.selection.filter((file) => file in files) };

	if (canvas.comments) next.comments = detachComments(canvas.comments, canvas.frames, kept);

	return next;
}

export function emptyCanvas(name: string, device: Device): CanvasDoc {
	const now = new Date().toISOString();

	return {
		version: 1,
		name,
		device,
		createdAt: now,
		updatedAt: now,
		frames: [],
		selection: [],
		alternates: [],
		comments: [],
	};
}

export const isContextFile = (path: string) => path === "PRODUCT.md" || path === "DESIGN.md";

export const isProjectFile = (path: string) => isScreenFile(path) || isComponentFile(path) || isContextFile(path);

/** `~/Documents/Rabisco/my-app.rabisco` → `my-app` */
export function projectNameFromPath(path: string) {
	const base =
		path
			.replace(/[\\/]+$/, "")
			.split(/[\\/]/)
			.pop() || "Untitled";

	return base.replace(/\.rabisco$/i, "") || "Untitled";
}

/** The first frame whose file exists; only the keys of `files` are read */
export function coverOf(canvas: CanvasDoc, files: ProjectFiles): ScreenCover | null {
	const frame = canvas.frames.find((f) => f.file in files);

	return frame ? { entry: frame.file, device: frame.device, width: frame.width, height: frame.height } : null;
}

/** The first frame with everything it needs to render on its own */
export function coverFor(canvas: CanvasDoc, files: ProjectFiles): ScreenSource | null {
	const frame = canvas.frames.find((f) => f.file in files);

	if (!frame) return null;
	const coverFiles: ProjectFiles = { [frame.file]: files[frame.file]! };

	for (const [path, content] of Object.entries(files)) if (isComponentFile(path)) coverFiles[path] = content;

	return {
		entry: frame.file,
		device: frame.device,
		width: frame.width,
		height: frame.height,
		files: coverFiles,
		theme: appliedTheme(canvas, files),
	};
}

/** Projects saved before tokens were applied on request take DESIGN.md's tokens as applied */
export function appliedTheme(canvas: CanvasDoc, files: ProjectFiles): AppliedTheme {
	return canvas.theme ?? designTokensOf(files["DESIGN.md"]);
}

/** Only the keys of `files` are read, so listing needs no file contents */
export function summarizeProject(path: string, canvas: CanvasDoc, files: ProjectFiles): ProjectSummary {
	return {
		path,
		name: canvas.name,
		device: canvas.device,
		updatedAt: canvas.updatedAt,
		screenCount: canvas.frames.length,
		cover: coverOf(canvas, files),
		missing: false,
	};
}
