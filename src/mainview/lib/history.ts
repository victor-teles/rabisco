import type { AssetDigests, AssetWrite } from "../../shared/assets";
import { detachComments } from "../../shared/comments";
import type { AppliedTheme } from "../../shared/context/theme";
import type {
	CanvasComment,
	CanvasImage,
	CanvasSection,
	Device,
	ElementLock,
	FileChange,
	Frame,
	ProjectFiles,
} from "../../shared/types";
import { remapLocks } from "./element-locks";

/** Recipes may omit `comments`, `theme`, `name` and `device`; `nextSnapshot` carries them over. */
export type Snapshot = {
	frames: Frame[];
	files: ProjectFiles;
	comments?: CanvasComment[];
	theme?: AppliedTheme;
	/** The project name */
	name?: string;
	/** The project's default device */
	device?: Device;
	locks?: ElementLock[];
	sections?: CanvasSection[];
	images?: CanvasImage[];
	assets?: AssetDigests;
};

/** Pins on removed frames are detached in the same step, so undo puts them back on their frame. */
export function nextSnapshot(present: Snapshot, update: Snapshot): Snapshot {
	if (update === present) return present;
	const comments = detachComments(update.comments ?? present.comments ?? [], present.frames, update.frames);
	const theme = update.theme ?? present.theme;
	const name = update.name ?? present.name;
	const device = update.device ?? present.device;
	const sections = update.sections ?? present.sections;
	const images = update.images ?? present.images;
	const assets = update.assets ?? present.assets;

	const locks =
		update.locks === undefined || update.locks === present.locks
			? present.locks && remapLocks(present.locks, present.files, update.files)
			: update.locks;

	if (
		comments === update.comments &&
		theme === update.theme &&
		name === update.name &&
		device === update.device &&
		locks === update.locks &&
		sections === update.sections &&
		images === update.images &&
		assets === update.assets
	)
		return update;

	return { ...update, comments, theme, name, device, locks, sections, images, assets };
}

export type History = {
	past: Snapshot[];
	present: Snapshot;
	future: Snapshot[];
	coalesceKey: string | null;
};

export const HISTORY_LIMIT = 200;

export function createHistory(present: Snapshot): History {
	return { past: [], present, future: [], coalesceKey: null };
}

export function commit(history: History, next: Snapshot, options: { coalesce?: string; limit?: number } = {}): History {
	if (next === history.present) return history;
	const key = options.coalesce ?? null;

	if (key !== null && key === history.coalesceKey) return { ...history, present: next, future: [] };
	const limit = options.limit ?? HISTORY_LIMIT;
	const past = [...history.past, history.present];

	if (past.length > limit) past.splice(0, past.length - limit);

	return { past, present: next, future: [], coalesceKey: key };
}

export function seal(history: History): History {
	return history.coalesceKey === null ? history : { ...history, coalesceKey: null };
}

export const canUndo = (history: History) => history.past.length > 0;

export const canRedo = (history: History) => history.future.length > 0;

export function undo(history: History): History {
	if (!canUndo(history)) return history;

	return {
		past: history.past.slice(0, -1),
		present: history.past.at(-1)!,
		future: [history.present, ...history.future],
		coalesceKey: null,
	};
}

export function redo(history: History): History {
	if (!canRedo(history)) return history;

	return {
		past: [...history.past, history.present],
		present: history.future[0]!,
		future: history.future.slice(1),
		coalesceKey: null,
	};
}

export function applyFileChanges(files: ProjectFiles, changes: FileChange[]): ProjectFiles {
	if (!changes.length) return files;
	const next = { ...files };

	for (const change of changes) {
		if (change.content === null) delete next[change.path];
		else next[change.path] = change.content;
	}

	return next;
}

export function diffFiles(from: ProjectFiles, to: ProjectFiles): FileChange[] {
	if (from === to) return [];
	const changes: FileChange[] = [];

	for (const path of Object.keys(from)) if (!(path in to)) changes.push({ path, content: null });

	for (const [path, content] of Object.entries(to)) if (from[path] !== content) changes.push({ path, content });

	return changes.sort((a, b) => a.path.localeCompare(b.path));
}

// Folds external changes into every snapshot so undo/redo never reverts them. Edits only touch
// snapshots that have the file, so undoing a file's creation still removes it.
export function rebase(
	history: History,
	changes: FileChange[],
	reconcile: (snapshot: Snapshot) => Snapshot = (snapshot) => snapshot,
): History {
	if (!changes.length) return history;
	const existing = history.present.files;

	const fold = (snapshot: Snapshot): Snapshot => {
		let files = snapshot.files;

		for (const change of changes) {
			const isEdit = change.content !== null && change.path in existing;

			if (isEdit && !(change.path in files)) continue;

			if (change.content === null ? !(change.path in files) : files[change.path] === change.content) continue;
			files = applyFileChanges(files, [change]);
		}

		return reconcile(files === snapshot.files ? snapshot : { ...snapshot, files });
	};

	return {
		past: history.past.map(fold),
		present: fold(history.present),
		future: history.future.map(fold),
		coalesceKey: null,
	};
}

export function applyAssetWrites(assets: AssetDigests, writes: AssetWrite[]): AssetDigests {
	if (!writes.length) return assets;
	const next = { ...assets };

	for (const { src, digest } of writes) {
		if (digest === null) delete next[src];
		else next[src] = digest;
	}

	return next;
}

export function diffAssets(from: AssetDigests, to: AssetDigests): AssetWrite[] {
	if (from === to) return [];
	const writes: AssetWrite[] = [];

	for (const src of Object.keys(from)) if (!(src in to)) writes.push({ src, digest: null });

	for (const [src, digest] of Object.entries(to)) if (from[src] !== digest) writes.push({ src, digest });

	return writes.sort((a, b) => a.src.localeCompare(b.src));
}

export function rebaseAssets(history: History, writes: AssetWrite[]): History {
	if (!writes.length) return history;
	const existing = history.present.assets ?? {};

	const fold = (snapshot: Snapshot): Snapshot => {
		const assets = snapshot.assets ?? {};
		let next = assets;

		for (const write of writes) {
			const isEdit = write.digest !== null && write.src in existing;

			if (isEdit && !(write.src in next)) continue;

			if (write.digest === null ? !(write.src in next) : next[write.src] === write.digest) continue;
			next = applyAssetWrites(next, [write]);
		}

		return next === assets ? snapshot : { ...snapshot, assets: next };
	};

	return {
		past: history.past.map(fold),
		present: fold(history.present),
		future: history.future.map(fold),
		coalesceKey: null,
	};
}
