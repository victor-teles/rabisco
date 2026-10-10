// Built in the webview, where TSX compiles and Tailwind builds; the main process only checks and serves it.
import { assetKey } from "../assets";
import { isFiniteNumber, isNumber, isString } from "../guards";
import { isJsonArray, isJsonObject, type Json, type JsonObject } from "../json";
import { isScreenFile, screenNameFromPath } from "../project";
import type { Device, Frame, ProjectFiles } from "../types";
import { isAlternate } from "../variations";

/** Compiled the way frames receive it (`ModulePayload`) */
export type ShareModule =
	| { source: string; code: string; error?: undefined }
	| { source: string; code?: undefined; error: { message: string; line: number; column?: number } };

export type ShareScreen = { file: string; name: string; device: Device; width: number; height: number };

export type ShareSnapshot = {
	version: 1;
	name: string;
	createdAt: string;
	start: string;
	screens: ShareScreen[];
	/** By project path */
	modules: Record<string, ShareModule>;
	css: string;
	/** DESIGN.md token overrides, loaded after `css` */
	theme: string;
	/** The project's `public/` images as `data:` URLs, by the `src` screens write (decision 0010) */
	assets?: Record<string, string>;
};

/** The same prebuilt runtime the canvas uses */
export type ScreenRuntime = { html: string; js: string };

export type ShareStatus = {
	/** The computer's address on the local network */
	url: string;
	localUrl: string;
	updatedAt: string;
	screens: number;
};

function assertModule(path: string, module: Json | undefined): asserts module is ShareModule {
	if (!isJsonObject(module) || !isString(module.source)) throw new Error(`Snapshot module ${path} has no source`);

	if (isString(module.code)) return;
	const error = module.error;

	if (!isJsonObject(error) || !isString(error.message) || !isNumber(error.line))
		throw new Error(`Snapshot module ${path} has neither code nor an error`);
}

function assertScreens(screens: readonly Json[], modules: JsonObject): asserts screens is ShareScreen[] {
	for (const screen of screens) {
		if (
			!isJsonObject(screen) ||
			!isString(screen.file) ||
			!isString(screen.name) ||
			(screen.device !== "mobile" && screen.device !== "desktop") ||
			!isFiniteNumber(screen.width) ||
			!isFiniteNumber(screen.height)
		)
			throw new Error("Snapshot has an invalid screen");

		if (!Object.hasOwn(modules, screen.file)) throw new Error(`Snapshot has no module for ${screen.file}`);
	}
}

function assertAssets(assets: Json): asserts assets is Record<string, string> {
	if (!isJsonObject(assets)) throw new Error("Snapshot assets aren't a map");

	for (const [src, url] of Object.entries(assets))
		if (!assetKey(src) || !isString(url) || !url.startsWith("data:image/"))
			throw new Error(`Snapshot asset ${src} isn't an image`);
}

function assertShareSnapshot(value: Json | undefined): asserts value is ShareSnapshot {
	if (!isJsonObject(value) || value.version !== 1) throw new Error("Not a share snapshot");
	const { name, createdAt, start, screens, modules, css, theme } = value;

	if (!isString(name) || !isString(createdAt) || !isString(start) || !isString(css) || !isString(theme))
		throw new Error("Snapshot is missing fields");

	if (!isJsonArray(screens) || screens.length === 0) throw new Error("There are no screens to share yet");

	if (!isJsonObject(modules)) throw new Error("Snapshot has no modules");
	assertScreens(screens, modules);

	for (const [path, module] of Object.entries(modules)) assertModule(path, module);

	if (value.assets !== undefined) assertAssets(value.assets);

	if (!screens.some((screen) => screen.file === start))
		throw new Error(`Snapshot starts on ${start}, which isn't one of its screens`);
}

/** Throws with what is wrong */
export function assertSnapshot(value: Json | undefined): ShareSnapshot {
	assertShareSnapshot(value);

	return value;
}

/** Canvas order, without alternates */
export function shareScreens(frames: Frame[], files: ProjectFiles): ShareScreen[] {
	return frames.flatMap(({ file, name, device, width, height }) =>
		isScreenFile(file) && !isAlternate(file) && files[file] !== undefined
			? [{ file, name: name || screenNameFromPath(file), device, width, height }]
			: [],
	);
}
