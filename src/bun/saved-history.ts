import { createHash } from "crypto";
import {
	copyFileSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { assetKey, PUBLIC_DIR, type AssetDigests, type AssetWrite } from "../shared/assets";
import { CHATS_DIR, LEGACY_CHAT_FILE } from "../shared/chats";
import { isNumber, isString } from "../shared/guards";
import { isJsonObject, type Json } from "../shared/json";
import { isProjectFile, projectNameFromPath } from "../shared/project";
import type { BackupReason, SavedHistory, SavedSnapshot, SavedVersion } from "../shared/saved-history";
import type { CanvasDoc, FileChange, ProjectFiles } from "../shared/types";
import { assetDigest } from "./assets";
import { arrayOr, objectOr, optionalString, parseJson } from "./json";
import {
	ATTACHMENTS_DIR,
	CANVAS_FILE,
	normalizeCanvas,
	readProjectFiles,
	writeCanvas,
	writeProjectFiles,
} from "./project-folder";

export const HISTORY_DIR = "history";

export const BACKUPS_DIR = "backups";

export const BACKUP_LIMIT = 10;

export const HISTORY_FILE_LIMIT = 64 * 1024 * 1024;

const BACKUP_HISTORY_FILE = "history.json";

const BACKUP_DIRS = [PUBLIC_DIR, CHATS_DIR, ATTACHMENTS_DIR];

const META_SUFFIX = ".meta.json";

const STASH_SUFFIX = ".images";

const DIGEST = /^[0-9a-f]{32}$/;

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

const metaFile = (userDataDir: string, dir: string) =>
	join(userDataDir, HISTORY_DIR, `${projectKey(dir)}${META_SUFFIX}`);

export const stashDir = (userDataDir: string, dir: string) =>
	join(userDataDir, HISTORY_DIR, `${projectKey(dir)}${STASH_SUFFIX}`);

function parseAssets(value: Json | undefined): AssetDigests | null {
	const assets: AssetDigests = {};

	for (const [src, digest] of Object.entries(objectOr(value))) {
		if (assetKey(src) !== src || !isString(digest) || !DIGEST.test(digest)) return null;
		assets[src] = digest;
	}

	return assets;
}

function parseSnapshot(value: Json | undefined, count: number, fallbackName: string): SavedSnapshot | null {
	if (!isJsonObject(value)) return null;
	const canvas = normalizeCanvas(value, fallbackName);
	const files: Record<string, number> = {};
	const assets = parseAssets(value.assets);

	for (const [path, index] of Object.entries(objectOr(value.files))) {
		if (!isProjectFile(path) || !isNumber(index) || !Number.isInteger(index) || index < 0 || index >= count)
			return null;
		files[path] = index;
	}

	if (!assets) return null;

	const snapshot: SavedSnapshot = {
		frames: canvas.frames,
		files,
		comments: canvas.comments ?? [],
		name: canvas.name,
		device: canvas.device,
		locks: canvas.locks ?? [],
		sections: canvas.sections ?? [],
		images: canvas.images ?? [],
		annotations: canvas.annotations ?? [],
		pages: canvas.pages ?? [],
	};

	if (canvas.theme) snapshot.theme = canvas.theme;

	if (isJsonObject(value.assets)) snapshot.assets = assets;

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
	const kind = raw.kind === "ai" || raw.kind === "checkpoint" || raw.kind === "agent" ? raw.kind : undefined;
	const agent = optionalString(raw.agent);
	const snapshot = parseSnapshot(raw.snapshot, count, fallbackName);

	if (!id || label === undefined || !at || !kind || !snapshot) return [];

	const version: SavedVersion = { id, kind, label, at, changed: arrayOr(raw.changed).filter(isString), snapshot };

	return [agent ? { ...version, agent } : version];
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

function writeAtomically(file: string, text: string) {
	const partial = `${file}.partial`;

	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(partial, text);
	renameSync(partial, file);
}

export function projectCreatedAt(dir: string): string | null {
	try {
		const canvas = parseJson(readFileSync(join(dir, CANVAS_FILE), "utf-8"));

		return isJsonObject(canvas) ? (optionalString(canvas.createdAt) ?? null) : null;
	} catch {
		return null;
	}
}

type HistoryMeta = { path: string; createdAt: string };

function readMeta(file: string): HistoryMeta | null {
	try {
		const meta = objectOr(parseJson(readFileSync(file, "utf-8")));
		const path = optionalString(meta.path);
		const createdAt = optionalString(meta.createdAt);

		return path && createdAt ? { path, createdAt } : null;
	} catch {
		return null;
	}
}

function referencedDigests(history: SavedHistory): Set<string> {
	const digests = new Set<string>();
	const snapshots = [history.present, ...history.past, ...history.future];

	for (const version of history.versions) snapshots.push(version.snapshot);

	for (const snapshot of snapshots) for (const digest of Object.values(snapshot.assets ?? {})) digests.add(digest);

	return digests;
}

function pruneStash(userDataDir: string, dir: string, history: SavedHistory) {
	const stash = stashDir(userDataDir, dir);

	if (!existsSync(stash)) return;
	const referenced = referencedDigests(history);

	for (const name of readdirSync(stash)) if (!referenced.has(name)) rmSync(join(stash, name), { force: true });
}

export function writeSavedHistory(userDataDir: string, dir: string, history: SavedHistory) {
	const createdAt = projectCreatedAt(dir);

	writeAtomically(historyFile(userDataDir, dir), JSON.stringify({ ...history, path: dir }));

	if (createdAt) writeFileSync(metaFile(userDataDir, dir), JSON.stringify({ path: dir, createdAt }));
	pruneStash(userDataDir, dir, history);
}

export function deleteSavedHistory(userDataDir: string, dir: string) {
	rmSync(historyFile(userDataDir, dir), { force: true });
	rmSync(metaFile(userDataDir, dir), { force: true });
	rmSync(stashDir(userDataDir, dir), { recursive: true, force: true });
}

function moveIfFree(from: string, to: string) {
	if (existsSync(from) && !existsSync(to)) {
		mkdirSync(dirname(to), { recursive: true });
		renameSync(from, to);
	}
}

function movedFrom(userDataDir: string, dir: string, createdAt: string): string | null {
	const historyDir = join(userDataDir, HISTORY_DIR);
	let newest: { path: string; at: number } | null = null;

	for (const name of existsSync(historyDir) ? readdirSync(historyDir) : []) {
		const meta = name.endsWith(META_SUFFIX) ? readMeta(join(historyDir, name)) : null;

		if (!meta || meta.createdAt !== createdAt || meta.path === dir || projectCreatedAt(meta.path) === createdAt)
			continue;
		const file = historyFile(userDataDir, meta.path);
		const at = existsSync(file) ? statSync(file).mtimeMs : -1;

		if (at >= 0 && (!newest || at > newest.at)) newest = { path: meta.path, at };
	}

	return newest?.path ?? null;
}

export function adoptMovedHistory(userDataDir: string, dir: string): string | null {
	if (existsSync(historyFile(userDataDir, dir))) return null;
	const createdAt = projectCreatedAt(dir);
	const from = createdAt && movedFrom(userDataDir, dir, createdAt);

	if (!createdAt || !from) return null;
	const saved = parseJson(readFileSync(historyFile(userDataDir, from), "utf-8"));

	if (!isJsonObject(saved)) return null;
	writeAtomically(historyFile(userDataDir, dir), JSON.stringify({ ...saved, path: dir }));
	writeFileSync(metaFile(userDataDir, dir), JSON.stringify({ path: dir, createdAt }));
	moveIfFree(stashDir(userDataDir, from), stashDir(userDataDir, dir));
	moveIfFree(backupsDir(userDataDir, from), backupsDir(userDataDir, dir));
	rmSync(historyFile(userDataDir, from), { force: true });
	rmSync(metaFile(userDataDir, from), { force: true });

	return from;
}

function stashFile(stash: string, target: string): string | null {
	if (!existsSync(target)) return null;

	if (lstatSync(target).isSymbolicLink()) throw new Error(`Rabisco doesn't replace links: ${target}`);
	const bytes = readFileSync(target);
	const digest = assetDigest(bytes);
	const blob = join(stash, digest);

	if (!existsSync(blob)) {
		mkdirSync(stash, { recursive: true });
		writeFileSync(blob, bytes);
	}

	return digest;
}

export function writeAssets(userDataDir: string, dir: string, writes: AssetWrite[]): string[] {
	const stash = stashDir(userDataDir, dir);
	const missing: string[] = [];

	for (const { src, digest } of writes) {
		if (assetKey(src) !== src || (digest !== null && !DIGEST.test(digest)))
			throw new Error(`Not a project image: ${src}`);
		const target = join(dir, PUBLIC_DIR, src);

		if (stashFile(stash, target) === digest) continue;

		if (digest === null) {
			rmSync(target, { force: true });
			continue;
		}

		const blob = join(stash, digest);

		if (!existsSync(blob)) {
			missing.push(src);
			continue;
		}

		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(blob, target);
	}

	return missing;
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

	for (const sub of BACKUP_DIRS)
		if (existsSync(join(dir, sub))) cpSync(join(dir, sub), join(target, sub), { recursive: true });
	copyIfExists(historyFile(userDataDir, dir), join(target, BACKUP_HISTORY_FILE));
	pruneBackups(folder, BACKUP_LIMIT);

	return target;
}
