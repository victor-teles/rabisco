import { mkdirSync, readdirSync, readFileSync, renameSync } from "fs";
import { join } from "path";
import { FRAME_GAP, FRAME_SIZE, emptyCanvas, uniqueScreenPath } from "../shared/project";
import type { CanvasDoc, ChatMessage, Device, FileChange, Frame } from "../shared/types";
import { appendChat, freeProjectDir, isChatMessage, writeCanvas, writeProjectFiles } from "./project-folder";
import type { RecentEntry } from "./recents";

/** Shape of the pre-Phase-1 `userData/projects/<id>.json` files. */
export type LegacyProject = {
	id: string;
	name: string;
	device: Device;
	createdAt: string;
	updatedAt: string;
	screens: { id: string; name: string; device: Device; x: number; y: number; width: number; height: number; html: string }[];
	messages: unknown[];
};

/** `order history` → `OrderHistory`; always a valid identifier. */
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

/** Splits a full HTML document into its `<style>` contents and `<body>` inner HTML. */
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

/** A TSX screen that renders a legacy HTML screen as it looked before. */
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

/** Files, canvas and chat of the folder that replaces a legacy project. */
export function convertLegacyProject(legacy: LegacyProject) {
	const device: Device = legacy.device === "desktop" ? "desktop" : "mobile";
	const changes: FileChange[] = [];
	const frames: Frame[] = [];
	const taken: string[] = [];
	for (const screen of Array.isArray(legacy.screens) ? legacy.screens : []) {
		const name = typeof screen.name === "string" && screen.name.trim() ? screen.name : "Screen";
		const file = uniqueScreenPath(name, taken);
		taken.push(file);
		changes.push({ path: file, content: legacyHtmlToTsx(String(screen.html ?? ""), name) });
		const screenDevice: Device = screen.device === "desktop" ? "desktop" : screen.device === "mobile" ? "mobile" : device;
		const size = FRAME_SIZE[screenDevice];
		frames.push({
			file,
			name,
			device: screenDevice,
			x: num(screen.x, frames.length * (size.width + FRAME_GAP)),
			y: num(screen.y, 0),
			width: num(screen.width, size.width),
			height: num(screen.height, size.height),
		});
	}
	const base = emptyCanvas(legacy.name || "Untitled", device);
	const canvas: CanvasDoc = {
		...base,
		createdAt: legacy.createdAt || base.createdAt,
		updatedAt: legacy.updatedAt || base.updatedAt,
		frames,
	};
	const messages: ChatMessage[] = (Array.isArray(legacy.messages) ? legacy.messages : []).filter(isChatMessage);
	return { canvas, changes, messages };
}

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * Moves every `<legacyDir>/*.json` into a project folder under `projectsDir`
 * and renames the old file to `*.json.migrated`, so it runs once. A file that
 * can't be migrated is left in place and logged.
 */
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
			const legacy = JSON.parse(readFileSync(source, "utf-8")) as LegacyProject;
			if (!legacy || typeof legacy !== "object" || !Array.isArray(legacy.screens)) throw new Error("not a legacy project");
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
