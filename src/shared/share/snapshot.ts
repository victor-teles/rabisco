// Built in the webview, where TSX compiles and Tailwind builds; the main process only checks and serves it.
import { assetKey } from "../assets";
import { draftCss, type DesignTokens } from "../context/tokens";
import { isFiniteNumber, isNumber, isString } from "../guards";
import { isJsonArray, isJsonObject, type Json, type JsonObject } from "../json";
import { normalizeModes, resolveDraft, resolveModes, type ResolvedMode } from "../modes";
import { isDevice, isScreenFile, screenNameFromPath } from "../project";
import type { CanvasSection, Device, Frame, ProjectFiles } from "../types";
import { isAlternate } from "../variations";

/** Compiled the way frames receive it (`ModulePayload`) */
export type ShareModule =
	| {
			source: string;
			code: string;
			icons?: string[];
			/** `start, end` of each JSX element, for the viewer's inspect mode (decision 0038) */
			elements?: number[];
			error?: undefined;
	  }
	| { source: string; code?: undefined; icons?: undefined; error: { message: string; line: number; column?: number } };

export type ShareScreen = {
	file: string;
	name: string;
	device: Device;
	width: number;
	height: number;
	/** Missing in snapshots written before decision 0028; those render the defaults */
	mode?: ResolvedMode;
	draft?: string;
};

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
	/** The default motion tokens, which link transitions use without their own timing (decision 0046) */
	motion?: { duration?: number; easing?: string };
	/** The shipped Inter as `data:` URLs, when the screens use Inter (decision 0049) */
	fonts?: ShareFont[];
};

export type ShareFont = { weight: number; unicodeRange: string; file: string };

/** The same prebuilt runtime the canvas uses */
export type ScreenRuntime = { html: string; js: string; icon?: (file: string) => string | null };

export type ShareStatus = {
	/** The computer's address on the local network */
	url: string;
	localUrl: string;
	updatedAt: string;
	screens: number;
};

function assertModule(path: string, module: Json | undefined): asserts module is ShareModule {
	if (!isJsonObject(module) || !isString(module.source)) throw new Error(`Snapshot module ${path} has no source`);

	if (isString(module.code)) {
		if (module.icons !== undefined && !(isJsonArray(module.icons) && module.icons.every(isString)))
			throw new Error(`Snapshot module ${path} has invalid icons`);

		if (module.elements !== undefined && !(isJsonArray(module.elements) && module.elements.every(isFiniteNumber)))
			throw new Error(`Snapshot module ${path} has invalid elements`);

		return;
	}

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
			!isDevice(screen.device) ||
			!isFiniteNumber(screen.width) ||
			!isFiniteNumber(screen.height) ||
			(screen.mode !== undefined && normalizeModes(screen.mode) === undefined) ||
			(screen.draft !== undefined && !isString(screen.draft))
		)
			throw new Error("Snapshot has an invalid screen");

		if (!Object.hasOwn(modules, screen.file)) throw new Error(`Snapshot has no module for ${screen.file}`);
	}
}

function assertAssets(assets: Json): asserts assets is Record<string, string> {
	if (!isJsonObject(assets)) throw new Error("Snapshot assets aren't a map");

	for (const [src, url] of Object.entries(assets))
		if (!assetKey(src) || !isString(url) || !/^data:(?:image|font)\//.test(url))
			throw new Error(`Snapshot asset ${src} isn't an image or a font`);
}

function assertMotion(motion: Json): asserts motion is { duration?: number; easing?: string } {
	if (
		!isJsonObject(motion) ||
		(motion.duration !== undefined && !isFiniteNumber(motion.duration)) ||
		(motion.easing !== undefined && !isString(motion.easing))
	)
		throw new Error("Snapshot motion isn't a duration and an easing");
}

function assertFonts(fonts: Json): asserts fonts is ShareFont[] {
	if (
		!isJsonArray(fonts) ||
		!fonts.every(
			(font) =>
				isJsonObject(font) &&
				isFiniteNumber(font.weight) &&
				isString(font.unicodeRange) &&
				isString(font.file) &&
				font.file.startsWith("data:font/"),
		)
	)
		throw new Error("Snapshot fonts aren't font files");
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

	if (value.motion !== undefined) assertMotion(value.motion);

	if (value.fonts !== undefined) assertFonts(value.fonts);

	if (!screens.some((screen) => screen.file === start))
		throw new Error(`Snapshot starts on ${start}, which isn't one of its screens`);
}

/** Throws with what is wrong */
export function assertSnapshot(value: Json | undefined): ShareSnapshot {
	assertShareSnapshot(value);

	return value;
}

/** Canvas order, without alternates */
export function shareScreens(
	frames: Frame[],
	files: ProjectFiles,
	sections: readonly CanvasSection[],
	theme: DesignTokens,
	drafts = false,
): ShareScreen[] {
	return frames.flatMap((frame) => {
		const { file, name, device, width, height } = frame;

		if (!isScreenFile(file) || isAlternate(file) || files[file] === undefined) return [];

		const screen: ShareScreen = {
			file,
			name: name || screenNameFromPath(file),
			device,
			width,
			height,
			mode: resolveModes(frame, sections, theme),
		};

		const draft = drafts ? resolveDraft(frame, sections) : undefined;

		if (draft) screen.draft = draftCss(draft);

		return [screen];
	});
}
