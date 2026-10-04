import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { emptyCanvas, isProjectFile, projectNameFromPath, reconcileFrames, toKebab } from "../shared/project";
import type { CanvasDoc, ChatMessage, Device, FileChange, Project, ProjectFiles } from "../shared/types";

/**
 * A project is a folder:
 * `rabisco.json` (canvas), `PRODUCT.md`, `DESIGN.md`, `screens/*.tsx`, `components/*.tsx`, `chat.jsonl`.
 */
export const CANVAS_FILE = "rabisco.json";
export const CHAT_FILE = "chat.jsonl";
const FILE_DIRS = ["screens", "components"];

export function isDirectory(path: string) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

export function assertProjectDir(path: string) {
	if (!path || !existsSync(path)) throw new Error(`Folder not found: ${path || "(empty path)"}`);
	if (!isDirectory(path)) throw new Error(`Not a folder: ${path}. Choose a folder to open as a project.`);
}

/** Rejects anything that isn't a screen, component or context file, including `..` and absolute paths. */
export function assertProjectFilePath(path: string) {
	if (typeof path !== "string" || !isProjectFile(path)) {
		throw new Error(`Rabisco can only write screens/*.tsx, components/*.tsx, PRODUCT.md and DESIGN.md (got "${path}")`);
	}
}

/** Reads every screen, component and context file of the folder. */
export function readProjectFiles(dir: string): ProjectFiles {
	const files: ProjectFiles = {};
	const candidates = ["PRODUCT.md", "DESIGN.md"];
	for (const sub of FILE_DIRS) {
		if (!isDirectory(join(dir, sub))) continue;
		for (const name of readdirSync(join(dir, sub))) candidates.push(`${sub}/${name}`);
	}
	for (const path of candidates) {
		if (!isProjectFile(path)) continue;
		const content = readFileIfExists(join(dir, path));
		if (content !== null) files[path] = content;
	}
	return files;
}

export function readFileIfExists(path: string): string | null {
	try {
		return statSync(path).isFile() ? readFileSync(path, "utf-8") : null;
	} catch {
		return null;
	}
}

/** Fills in anything missing from a hand-edited or older `rabisco.json`. */
export function normalizeCanvas(raw: unknown, fallbackName: string): CanvasDoc {
	const base = emptyCanvas(fallbackName, "mobile");
	if (!raw || typeof raw !== "object") return base;
	const doc = raw as Partial<CanvasDoc>;
	const device: Device = doc.device === "desktop" ? "desktop" : "mobile";
	return {
		version: 1,
		name: typeof doc.name === "string" && doc.name.trim() ? doc.name : fallbackName,
		device,
		createdAt: typeof doc.createdAt === "string" ? doc.createdAt : base.createdAt,
		updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : base.updatedAt,
		frames: Array.isArray(doc.frames)
			? doc.frames.filter((f) => f && typeof f.file === "string" && typeof f.x === "number" && typeof f.y === "number")
			: [],
		selection: Array.isArray(doc.selection) ? doc.selection.filter((s) => typeof s === "string") : [],
		alternates: Array.isArray(doc.alternates) ? doc.alternates : [],
	};
}

/** `null` when the folder has no `rabisco.json` yet. Throws when it exists but isn't valid JSON. */
export function readCanvas(dir: string): CanvasDoc | null {
	const text = readFileIfExists(join(dir, CANVAS_FILE));
	if (text === null) return null;
	try {
		return normalizeCanvas(JSON.parse(text), projectNameFromPath(dir));
	} catch {
		throw new Error(`${CANVAS_FILE} in ${dir} is not valid JSON. Fix or delete it, then open the folder again.`);
	}
}

export function writeCanvas(dir: string, canvas: CanvasDoc) {
	writeFileSync(join(dir, CANVAS_FILE), `${JSON.stringify(canvas, null, "\t")}\n`);
}

/** One `ChatMessage` per line; malformed lines are skipped. */
export function parseChat(text: string): ChatMessage[] {
	const messages: ChatMessage[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const message = JSON.parse(line);
			if (isChatMessage(message)) messages.push(message);
		} catch {}
	}
	return messages;
}

export function isChatMessage(value: unknown): value is ChatMessage {
	const m = value as ChatMessage;
	return (
		!!m &&
		typeof m.id === "string" &&
		(m.role === "user" || m.role === "assistant") &&
		typeof m.content === "string" &&
		typeof m.createdAt === "string"
	);
}

export function appendChat(dir: string, messages: ChatMessage[]) {
	if (!messages.length) return;
	appendFileSync(join(dir, CHAT_FILE), messages.map((m) => `${JSON.stringify(m)}\n`).join(""));
}

/**
 * Loads a folder as a project. Creates `rabisco.json` when it's missing and
 * saves it again when frames had to be reconciled with the files on disk.
 */
export function loadProject(dir: string): Project {
	assertProjectDir(dir);
	const files = readProjectFiles(dir);
	const stored = readCanvas(dir);
	const canvas = reconcileFrames(stored ?? emptyCanvas(projectNameFromPath(dir), "mobile"), files);
	if (!stored || canvas !== stored) writeCanvas(dir, canvas);
	const messages = parseChat(readFileIfExists(join(dir, CHAT_FILE)) ?? "");
	return { path: dir, canvas, files, messages };
}

/** Applies writes and deletes after validating every path, so a bad path writes nothing. */
export function writeProjectFiles(dir: string, changes: FileChange[]) {
	for (const change of changes) assertProjectFilePath(change.path);
	for (const { path, content } of changes) {
		const target = join(dir, path);
		if (content === null) {
			rmSync(target, { force: true });
			continue;
		}
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
}

/** `<parent>/<kebab-name>.rabisco`, with `-2`, `-3`… when taken. */
export function freeProjectDir(parent: string, name: string) {
	const base = /[a-z0-9]/i.test(name) ? toKebab(name) : "untitled";
	let dir = join(parent, `${base}.rabisco`);
	for (let n = 2; existsSync(dir); n++) dir = join(parent, `${base}-${n}.rabisco`);
	return dir;
}

export function createProjectFolder(parent: string, name: string, device: Device) {
	const dir = freeProjectDir(parent, name);
	mkdirSync(dir, { recursive: true });
	writeCanvas(dir, emptyCanvas(name.trim() || "Untitled", device));
	return dir;
}
