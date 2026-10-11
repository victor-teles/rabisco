import { createHash } from "crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "fs";
import { basename, join } from "path";
import { LEGACY_CHAT_FILE } from "../shared/chats";
import { isNumber, isString } from "../shared/guards";
import { isJsonObject, type Json } from "../shared/json";
import { isProjectFile, projectNameFromPath } from "../shared/project";
import type { BackupReason, SavedHistory, SavedSnapshot, SavedVersion } from "../shared/saved-history";
import type { CanvasDoc, FileChange, ProjectFiles } from "../shared/types";
import { arrayOr, objectOr, optionalString, parseJson } from "./json";
import { CANVAS_FILE, normalizeCanvas, readProjectFiles, writeCanvas, writeProjectFiles } from "./project-folder";

export const HISTORY_DIR = "history";

export const BACKUPS_DIR = "backups";

export const BACKUP_LIMIT = 10;

export const HISTORY_FILE_LIMIT = 64 * 1024 * 1024;

const BACKUP_HISTORY_FILE = "history.json";

export function projectKey(dir: string) {
	const name =
		basename(dir)
			.replace(/[^\w.-]+/g, "-")
			.slice(0, 40) || "project";

	const hash = createHash("sha256").update(dir).digest("hex").slice(0, 12);

	return `${name}-${hash}`;
}

export const historyFile = (userDataDir: string, dir: string) =>
	join(userDataDir, HISTORY_DIR, `${projectKey(dir)}.json`);

export const backupsDir = (userDataDir: string, dir: string) => join(userDataDir, BACKUPS_DIR, projectKey(dir));

function parseSnapshot(value: Json | undefined, count: number, fallbackName: string): SavedSnapshot | null {
	if (!isJsonObject(value)) return null;
	const canvas = normalizeCanvas(value, fallbackName);
	const files: Record<string, number> = {};

	for (const [path, index] of Object.entries(objectOr(value.files))) {
		if (!isProjectFile(path) || !isNumber(index) || !Number.isInteger(index) || index < 0 || index >= count)
			return null;
		files[path] = index;
	}

	const snapshot: SavedSnapshot = {
		frames: canvas.frames,
		files,
		comments: canvas.comments ?? [],
		name: canvas.name,
		device: canvas.device,
		locks: canvas.locks ?? [],
		sections: canvas.sections ?? [],
	};

	if (canvas.theme) snapshot.theme = canvas.theme;

	return snapshot;
}

function parseSnapshots(value: Json | undefined, count: number, fallbackName: string): SavedSnapshot[] | null {
	const snapshots: SavedSnapshot[] = [];

	for (const entry of arrayOr(value)) {
		const snapshot = parseSnapshot(entry, count, fallbackName);

		if (!snapshot) return null;
		snapshots.push(snapshot);
	}

	return snapshots;
}

function parseVersion(value: Json, count: number, fallbackName: string): SavedVersion[] {
	const raw = objectOr(value);
	const id = optionalString(raw.id);
	const label = optionalString(raw.label);
	const at = optionalString(raw.at);
	const kind = raw.kind === "ai" || raw.kind === "checkpoint" ? raw.kind : undefined;
	const snapshot = parseSnapshot(raw.snapshot, count, fallbackName);

	if (!id || label === undefined || !at || !kind || !snapshot) return [];

	return [{ id, kind, label, at, changed: arrayOr(raw.changed).filter(isString), snapshot }];
}

export function parseSavedHistory(value: Json, dir: string): SavedHistory | null {
	if (!isJsonObject(value) || value.version !== 1 || value.path !== dir) return null;
	const contents = arrayOr(value.contents);

	if (!contents.every(isString)) return null;
	const strings = contents.filter(isString);
	const name = projectNameFromPath(dir);
	const present = parseSnapshot(value.present, strings.length, name);
	const past = parseSnapshots(value.past, strings.length, name);
	const future = parseSnapshots(value.future, strings.length, name);

	if (!present || !past || !future) return null;

	return {
		version: 1,
		savedAt: optionalString(value.savedAt) ?? "",
		contents: strings,
		past,
		present,
		future,
		versions: arrayOr(value.versions).flatMap((version) => parseVersion(version, strings.length, name)),
	};
}

export function readSavedHistory(userDataDir: string, dir: string): SavedHistory | null {
	const file = historyFile(userDataDir, dir);

	try {
		if (statSync(file).size > HISTORY_FILE_LIMIT) return null;

		return parseSavedHistory(parseJson(readFileSync(file, "utf-8")), dir);
	} catch {
		return null;
	}
}

export function writeSavedHistory(userDataDir: string, dir: string, history: SavedHistory) {
	const file = historyFile(userDataDir, dir);
	const partial = `${file}.partial`;

	mkdirSync(join(userDataDir, HISTORY_DIR), { recursive: true });
	writeFileSync(partial, JSON.stringify({ ...history, path: dir }));
	renameSync(partial, file);
}

export function deleteSavedHistory(userDataDir: string, dir: string) {
	rmSync(historyFile(userDataDir, dir), { force: true });
}

export type BackupContents = { files: ProjectFiles; canvas: CanvasDoc };

function backupName(reason: BackupReason, now: Date) {
	return `${now.toISOString().replace(/[:.]/g, "-")}-${reason}`;
}

function pruneBackups(folder: string, limit: number) {
	const names = readdirSync(folder).sort();

	for (const name of names.slice(0, Math.max(0, names.length - limit)))
		rmSync(join(folder, name), { recursive: true, force: true });
}

function copyIfExists(from: string, to: string) {
	if (existsSync(from)) copyFileSync(from, to);
}

export function backupProject(
	userDataDir: string,
	dir: string,
	reason: BackupReason,
	contents?: BackupContents,
	now = new Date(),
): string {
	const folder = backupsDir(userDataDir, dir);
	let target = join(folder, backupName(reason, now));

	for (let n = 2; existsSync(target); n++) target = join(folder, `${backupName(reason, now)}-${n}`);
	mkdirSync(target, { recursive: true });

	const files = contents?.files ?? readProjectFiles(dir);
	const changes: FileChange[] = Object.entries(files).map(([path, content]) => ({ path, content }));

	writeProjectFiles(target, changes);

	if (contents) writeCanvas(target, contents.canvas);
	else copyIfExists(join(dir, CANVAS_FILE), join(target, CANVAS_FILE));
	copyIfExists(join(dir, LEGACY_CHAT_FILE), join(target, LEGACY_CHAT_FILE));
	copyIfExists(historyFile(userDataDir, dir), join(target, BACKUP_HISTORY_FILE));
	pruneBackups(folder, BACKUP_LIMIT);

	return target;
}
