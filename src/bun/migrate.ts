import { mkdirSync, readdirSync, readFileSync, renameSync } from "fs";
import { join } from "path";
import { isFiniteNumber } from "../shared/guards";
import { isJsonArray, isJsonObject, type Json } from "../shared/json";
import { FRAME_GAP, FRAME_SIZE, emptyCanvas, uniqueScreenPath } from "../shared/project";
import type { CanvasDoc, ChatMessage, Device, FileChange, Frame } from "../shared/types";
import { appendChat, freeProjectDir, isChatMessage, writeCanvas, writeProjectFiles } from "./project-folder";
import { arrayOr, objectOr, optionalString, parseJson } from "./json";
import type { RecentEntry } from "./recents";

/** Missing or invalid fields are left out. */
export type LegacyScreen = {
	name?: string;
	device?: Device;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	html: string;
};

/** Pre-Phase-1 `userData/projects/<id>.json` */
export type LegacyProject = {
	name?: string;
	device?: Device;
	createdAt?: string;
	updatedAt?: string;
	screens: LegacyScreen[];
	messages: ChatMessage[];
};

const parseDevice = (value: Json | undefined): Device | undefined =>
	value === "desktop" || value === "mobile" ? value : undefined;

const finiteNumber = (value: Json | undefined) => (isFiniteNumber(value) ? value : undefined);

function parseLegacyScreen(value: Json): LegacyScreen {
	const screen = objectOr(value);

	return {
		name: optionalString(screen.name),
		device: parseDevice(screen.device),
		x: finiteNumber(screen.x),
		y: finiteNumber(screen.y),
		width: finiteNumber(screen.width),
		height: finiteNumber(screen.height),
		html: String(screen.html ?? ""),
	};
}

function parseLegacyProject(value: Json): LegacyProject {
	if (!isJsonObject(value) || !isJsonArray(value.screens)) throw new Error("not a legacy project");

	return {
		name: optionalString(value.name),
		device: parseDevice(value.device),
		createdAt: optionalString(value.createdAt),
		updatedAt: optionalString(value.updatedAt),
		screens: value.screens.map(parseLegacyScreen),
		messages: arrayOr(value.messages).filter(isChatMessage),
	};
}

/** Always a valid identifier. */
export function componentName(name: string) {
	const pascal = name
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^A-Za-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.filter(Boolean)
		.map((w) => w[0]!.toUpperCase() + w.slice(1))
		.join("");

	return /^[A-Za-z]/.test(pascal) ? pascal : `Screen${pascal}`;
}

export function splitHtmlDocument(html: string) {
	const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]!.trim()).join("\n");
	const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);

	const markup = body
		? body[1]!
		: html
				.replace(/<!doctype[^>]*>/gi, "")
				.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
				.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
				.replace(/<\/?(html|body)[^>]*>/gi, "");

	return { css, markup: markup.trim() };
}

export function legacyHtmlToTsx(html: string, name: string) {
	const { css, markup } = splitHtmlDocument(html);

	return `/** Migrated from an HTML screen. Rewrite it as components when you next edit it. */
const CSS = ${JSON.stringify(css)};

const HTML = ${JSON.stringify(markup)};

export default function ${componentName(name)}() {
	return (
		<>
			<style>{CSS}</style>
			<div className="relative h-full overflow-hidden" dangerouslySetInnerHTML={{ __html: HTML }} />
		</>
	);
}
`;
}

export function convertLegacyProject(legacy: LegacyProject) {
	const device = legacy.device ?? "mobile";
	const changes: FileChange[] = [];
	const frames: Frame[] = [];
	const taken: string[] = [];

	for (const screen of legacy.screens) {
		const name = screen.name?.trim() ? screen.name : "Screen";
		const file = uniqueScreenPath(name, taken);
		taken.push(file);
		changes.push({ path: file, content: legacyHtmlToTsx(screen.html, name) });

		const screenDevice = screen.device ?? device;

		const size = FRAME_SIZE[screenDevice];
		frames.push({
			file,
			name,
			device: screenDevice,
			x: screen.x ?? frames.length * (size.width + FRAME_GAP),
			y: screen.y ?? 0,
			width: screen.width ?? size.width,
			height: screen.height ?? size.height,
		});
	}

	const base = emptyCanvas(legacy.name || "Untitled", device);

	const canvas: CanvasDoc = {
		...base,
		createdAt: legacy.createdAt || base.createdAt,
		updatedAt: legacy.updatedAt || base.updatedAt,
		frames,
	};

	return { canvas, changes, messages: legacy.messages };
}

/** Renames migrated files to `*.json.migrated` so it runs once; failures stay in place and are logged. */
export function migrateLegacyProjects(legacyDir: string, projectsDir: string): RecentEntry[] {
	let names: string[];

	try {
		names = readdirSync(legacyDir).filter((n) => n.endsWith(".json"));
	} catch {
		return [];
	}

	const migrated: RecentEntry[] = [];

	for (const fileName of names) {
		const source = join(legacyDir, fileName);

		try {
			const legacy = parseLegacyProject(parseJson(readFileSync(source, "utf-8")));
			const { canvas, changes, messages } = convertLegacyProject(legacy);
			mkdirSync(projectsDir, { recursive: true });
			const dir = freeProjectDir(projectsDir, canvas.name);
			mkdirSync(dir, { recursive: true });
			writeProjectFiles(dir, changes);
			writeCanvas(dir, canvas);
			appendChat(dir, messages);
			renameSync(source, `${source}.migrated`);
			migrated.push({ path: dir, openedAt: canvas.updatedAt });
		} catch (error) {
			console.error(`Could not migrate ${source}: ${error instanceof Error ? error.message : error}`);
		}
	}

	return migrated;
}
