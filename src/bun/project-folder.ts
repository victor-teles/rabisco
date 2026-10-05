import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { CONTEXT_TEMPLATES } from "../shared/context/templates";
import { normalizeComments } from "../shared/comments";
import { isString } from "../shared/guards";
import { isJsonObject, type Json } from "../shared/json";
import {
	emptyCanvas,
	FRAME_SIZE,
	isProjectFile,
	projectNameFromPath,
	reconcileFrames,
	screenNameFromPath,
	toKebab,
} from "../shared/project";
import type { Attachment } from "../shared/ai/contract";
import type {
	AlternateGroup,
	CanvasDoc,
	ChatMessage,
	Device,
	FileChange,
	Frame,
	Project,
	ProjectFiles,
} from "../shared/types";
import { arrayOr, objectOr, optionalNumber, optionalString, parseJson } from "./json";

export const CANVAS_FILE = "rabisco.json";

export const CHAT_FILE = "chat.jsonl";

/** Images attached to prompts; `chat.jsonl` refers to them by path */
export const ATTACHMENTS_DIR = "attachments";

const IMAGE_EXTENSIONS: Record<Attachment["mediaType"], string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
};

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

/** Also rejects `..` and absolute paths. */
export function assertProjectFilePath(path: string) {
	if (!isString(path) || !isProjectFile(path)) {
		throw new Error(`Rabisco can only write screens/*.tsx, components/*.tsx, PRODUCT.md and DESIGN.md (got "${path}")`);
	}
}

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

const parseDevice = (value: Json | undefined): Device | undefined =>
	value === "desktop" || value === "mobile" ? value : undefined;

function parseFrame(value: Json, canvasDevice: Device): Frame[] {
	const frame = objectOr(value);
	const file = optionalString(frame.file);
	const x = optionalNumber(frame.x);
	const y = optionalNumber(frame.y);

	if (file === undefined || x === undefined || y === undefined) return [];
	const device = parseDevice(frame.device) ?? canvasDevice;
	const size = FRAME_SIZE[device];

	return [
		{
			file,
			name: optionalString(frame.name) ?? screenNameFromPath(file),
			device,
			x,
			y,
			width: optionalNumber(frame.width) ?? size.width,
			height: optionalNumber(frame.height) ?? size.height,
		},
	];
}

function parseAlternateGroup(value: Json): AlternateGroup[] {
	const group = objectOr(value);
	const picked = optionalString(group.picked);

	return picked === undefined ? [] : [{ picked, files: arrayOr(group.files).filter(isString) }];
}

export function normalizeCanvas(raw: Json | undefined, fallbackName: string): CanvasDoc {
	const base = emptyCanvas(fallbackName, "mobile");

	if (!isJsonObject(raw)) return base;
	const name = optionalString(raw.name);
	const device = parseDevice(raw.device) ?? "mobile";

	return {
		version: 1,
		name: name?.trim() ? name : fallbackName,
		device,
		createdAt: optionalString(raw.createdAt) ?? base.createdAt,
		updatedAt: optionalString(raw.updatedAt) ?? base.updatedAt,
		frames: arrayOr(raw.frames).flatMap((frame) => parseFrame(frame, device)),
		selection: arrayOr(raw.selection).filter(isString),
		alternates: arrayOr(raw.alternates).flatMap(parseAlternateGroup),
		comments: normalizeComments(raw.comments),
	};
}

/** `null` when missing; throws when it exists but isn't valid JSON. */
export function readCanvas(dir: string): CanvasDoc | null {
	const text = readFileIfExists(join(dir, CANVAS_FILE));

	if (text === null) return null;

	try {
		return normalizeCanvas(parseJson(text), projectNameFromPath(dir));
	} catch {
		throw new Error(`${CANVAS_FILE} in ${dir} is not valid JSON. Fix or delete it, then open the folder again.`);
	}
}

export function writeCanvas(dir: string, canvas: CanvasDoc) {
	writeFileSync(join(dir, CANVAS_FILE), `${JSON.stringify(canvas, null, "\t")}\n`);
}

/** Malformed lines are skipped. Images load only with `readAttachment`; the AI history doesn't need them. */
export function parseChat(text: string, readAttachment?: (path: string) => string | null): ChatMessage[] {
	const messages: ChatMessage[] = [];

	for (const line of text.split("\n")) {
		if (!line.trim()) continue;

		try {
			const value = parseJson(line);

			if (!isChatMessage(value)) continue;
			const message: ChatMessage = { ...value };
			delete message.attachments;

			const images = readAttachment
				? arrayOr(objectOr(value).attachments).flatMap((ref) => loadAttachment(ref, readAttachment))
				: [];

			if (images.length) message.attachments = images;
			messages.push(message);
		} catch {}
	}

	return messages;
}

const isImageType = (value: Json | undefined): value is Attachment["mediaType"] =>
	isString(value) && Object.hasOwn(IMAGE_EXTENSIONS, value);

const ATTACHMENT_PATH = /^attachments\/[\w-]+\.(png|jpg|webp|gif)$/;

function loadAttachment(ref: Json, read: (path: string) => string | null): Attachment[] {
	const stored = objectOr(ref);
	const name = optionalString(stored.name) ?? "image";
	const path = optionalString(stored.path);

	if (!isImageType(stored.mediaType) || !path || !ATTACHMENT_PATH.test(path)) return [];
	const data = read(path);

	return data === null ? [] : [{ name, mediaType: stored.mediaType, data }];
}

export function isChatMessage(value: unknown): value is ChatMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		"id" in value &&
		typeof value.id === "string" &&
		"role" in value &&
		(value.role === "user" || value.role === "assistant") &&
		"content" in value &&
		typeof value.content === "string" &&
		"createdAt" in value &&
		typeof value.createdAt === "string"
	);
}

/** Writes attached images to `attachments/` and keeps only their paths in the chat. */
export function appendChat(dir: string, messages: ChatMessage[]) {
	if (!messages.length) return;

	const lines = messages.map((message) => {
		const images = (message.attachments ?? []).filter((image) => isImageType(image.mediaType));

		if (!images.length) return JSON.stringify({ ...message, attachments: undefined });
		mkdirSync(join(dir, ATTACHMENTS_DIR), { recursive: true });
		const id = message.id.replace(/[^\w-]/g, "") || crypto.randomUUID();

		const attachments = images.map((image, index) => {
			const path = `${ATTACHMENTS_DIR}/${id}-${index}.${IMAGE_EXTENSIONS[image.mediaType]}`;
			writeFileSync(join(dir, path), Buffer.from(image.data, "base64"));

			return { name: image.name, mediaType: image.mediaType, path };
		});

		return JSON.stringify({ ...message, attachments });
	});

	appendFileSync(join(dir, CHAT_FILE), lines.map((line) => `${line}\n`).join(""));
}

/** Base64, or `null` when the file is gone */
function readAttachment(dir: string, path: string) {
	try {
		return readFileSync(join(dir, path)).toString("base64");
	} catch {
		return null;
	}
}

/** Writes `rabisco.json` when missing or when frames had to be reconciled with the files on disk. */
export function loadProject(dir: string): Project {
	assertProjectDir(dir);
	const files = readProjectFiles(dir);
	const stored = readCanvas(dir);
	const canvas = reconcileFrames(stored ?? emptyCanvas(projectNameFromPath(dir), "mobile"), files);

	if (!stored || canvas !== stored) writeCanvas(dir, canvas);
	const messages = parseChat(readFileIfExists(join(dir, CHAT_FILE)) ?? "", (path) => readAttachment(dir, path));

	return { path: dir, canvas, files, messages };
}

/** Validates every path first, so a bad path writes nothing. */
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

	for (const [file, template] of Object.entries(CONTEXT_TEMPLATES)) writeFileSync(join(dir, file), template);

	return dir;
}
