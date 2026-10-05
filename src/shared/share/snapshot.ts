/**
 * A read-only snapshot of a project (decision 0008): what the share link and
 * "Export as website" serve. The webview builds it, because that is where TSX
 * compiles and Tailwind builds (decisions 0001 and 0002); the main process only
 * checks its shape and serves it.
 */
import { isScreenFile, screenNameFromPath } from "../project";
import type { Device, Frame, ProjectFiles } from "../types";
import { isAlternate } from "../variations";

/** One project module, compiled the way frames receive it (`ModulePayload` in the render protocol). */
export type ShareModule =
	| { source: string; code: string; error?: undefined }
	| { source: string; code?: undefined; error: { message: string; line: number; column?: number } };

/** A screen of the viewer, in canvas order. */
export type ShareScreen = { file: string; name: string; device: Device; width: number; height: number };

export type ShareSnapshot = {
	version: 1;
	/** Project name */
	name: string;
	createdAt: string;
	/** The screen the viewer opens on */
	start: string;
	screens: ShareScreen[];
	/** Every module the screens import, by project path */
	modules: Record<string, ShareModule>;
	/** The Tailwind stylesheet shared by every frame */
	css: string;
	/** DESIGN.md token overrides, loaded after `css` */
	theme: string;
};

/** The prebuilt screen runtime (`runtime/frame.html` and `runtime/frame.js`), the same one the canvas uses. */
export type ScreenRuntime = { html: string; js: string };

/** A running share link. */
export type ShareStatus = {
	/** The link to send: the computer's address on the local network */
	url: string;
	/** The same link on this computer */
	localUrl: string;
	/** When the snapshot behind the link was last updated */
	updatedAt: string;
	screens: number;
};

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";

function assertModule(path: string, module: unknown): asserts module is ShareModule {
	if (!isObject(module) || !isString(module.source)) throw new Error(`Snapshot module ${path} has no source`);
	if (isString(module.code)) return;
	const error = module.error;
	if (!isObject(error) || !isString(error.message) || typeof error.line !== "number") throw new Error(`Snapshot module ${path} has neither code nor an error`);
}

/** Checks a snapshot that came over RPC. Returns it, or throws with what is wrong. */
export function assertSnapshot(value: unknown): ShareSnapshot {
	if (!isObject(value) || value.version !== 1) throw new Error("Not a share snapshot");
	const { name, createdAt, start, screens, modules, css, theme } = value;
	if (!isString(name) || !isString(createdAt) || !isString(start) || !isString(css) || !isString(theme)) throw new Error("Snapshot is missing fields");
	if (!Array.isArray(screens) || screens.length === 0) throw new Error("There are no screens to share yet");
	if (!isObject(modules)) throw new Error("Snapshot has no modules");
	for (const screen of screens as unknown[]) {
		const ok =
			isObject(screen) &&
			isString(screen.file) &&
			isString(screen.name) &&
			(screen.device === "mobile" || screen.device === "desktop") &&
			Number.isFinite(screen.width) &&
			Number.isFinite(screen.height);
		if (!ok) throw new Error("Snapshot has an invalid screen");
		if (!Object.hasOwn(modules, screen.file as string)) throw new Error(`Snapshot has no module for ${screen.file}`);
	}
	for (const [path, module] of Object.entries(modules)) assertModule(path, module);
	if (!(screens as ShareScreen[]).some((screen) => screen.file === start)) throw new Error(`Snapshot starts on ${start}, which isn't one of its screens`);
	return value as ShareSnapshot;
}

/** Screens a viewer shows: the canvas's screens in canvas order, without the alternates (picked designs only). */
export function shareScreens(frames: Frame[], files: ProjectFiles): ShareScreen[] {
	return frames
		.filter((frame) => isScreenFile(frame.file) && !isAlternate(frame.file) && files[frame.file] !== undefined)
		.map(({ file, name, device, width, height }) => ({ file, name: name || screenNameFromPath(file), device, width, height }));
}
