import { rebaseCanvas } from "@/lib/canvas-rebase";
import { canRedo, canUndo, createHistory, diffFiles, rebase, type History, type Snapshot } from "@/lib/history";
import type { SessionVersion } from "@/lib/versions";
import { isJsonObject, type Json, type JsonObject } from "../../shared/json";
import type { SavedHistory, SavedSnapshot, SavedVersion } from "../../shared/saved-history";

export const SAVED_HISTORY_CHARS = 16 * 1024 * 1024;

type Packer = { contents: string[]; index: Map<string, number>; chars: number; budget: number };

function packSnapshot(packer: Packer, snapshot: Snapshot): SavedSnapshot {
	const files: Record<string, number> = {};

	for (const [path, content] of Object.entries(snapshot.files)) {
		let at = packer.index.get(content);

		if (at === undefined) {
			at = packer.contents.length;
			packer.contents.push(content);
			packer.index.set(content, at);
			packer.chars += content.length;
		}

		files[path] = at;
	}

	const saved: SavedSnapshot = {
		frames: snapshot.frames,
		files,
		comments: snapshot.comments ?? [],
		name: snapshot.name ?? "",
		device: snapshot.device ?? "mobile",
		locks: snapshot.locks ?? [],
		sections: snapshot.sections ?? [],
		images: snapshot.images ?? [],
	};

	if (snapshot.theme) saved.theme = snapshot.theme;

	return saved;
}

function packWithin(packer: Packer, snapshot: Snapshot): SavedSnapshot | null {
	const count = packer.contents.length;
	const chars = packer.chars;
	const saved = packSnapshot(packer, snapshot);

	if (packer.chars <= packer.budget) return saved;

	for (const content of packer.contents.splice(count)) packer.index.delete(content);
	packer.chars = chars;

	return null;
}

function packNewestFirst<T, S>(entries: T[], pack: (entry: T) => S | null): S[] {
	const packed: S[] = [];

	for (let i = entries.length - 1; i >= 0; i--) {
		const saved = pack(entries[i]!);

		if (!saved) break;
		packed.push(saved);
	}

	return packed.reverse();
}

export function packHistory(
	history: History,
	versions: SessionVersion[],
	now: Date,
	budget = SAVED_HISTORY_CHARS,
): SavedHistory {
	const packer: Packer = { contents: [], index: new Map(), chars: 0, budget };
	const present = packSnapshot(packer, history.present);

	const saved = packNewestFirst(versions, (version): SavedVersion | null => {
		const snapshot = packWithin(packer, version.snapshot);

		return snapshot && { ...version, snapshot };
	});

	const future: SavedSnapshot[] = [];

	for (const snapshot of history.future) {
		const packed = packWithin(packer, snapshot);

		if (!packed) break;
		future.push(packed);
	}

	const past = packNewestFirst(history.past, (snapshot) => packWithin(packer, snapshot));

	return {
		version: 1,
		savedAt: now.toISOString(),
		contents: packer.contents,
		past,
		present,
		future,
		versions: saved,
	};
}

function unpackSnapshot(contents: string[], saved: SavedSnapshot): Snapshot {
	const files: Record<string, string> = {};

	for (const [path, at] of Object.entries(saved.files)) files[path] = contents[at] ?? "";

	return {
		frames: saved.frames,
		files,
		comments: saved.comments,
		theme: saved.theme,
		name: saved.name,
		device: saved.device,
		locks: saved.locks,
		sections: saved.sections,
		images: saved.images ?? [],
	};
}

export type Unpacked = { history: History; versions: SessionVersion[] };

export function unpackHistory(saved: SavedHistory): Unpacked {
	const unpack = (snapshot: SavedSnapshot) => unpackSnapshot(saved.contents, snapshot);

	return {
		history: {
			past: saved.past.map(unpack),
			present: unpack(saved.present),
			future: saved.future.map(unpack),
			coalesceKey: null,
		},
		versions: saved.versions.map((version) => ({ ...version, snapshot: unpack(version.snapshot) })),
	};
}

function sortKeys(_key: string, value: Json): Json {
	if (!isJsonObject(value)) return value;
	const sorted: Record<string, Json | undefined> = {};

	for (const key of Object.keys(value).sort()) sorted[key] = value[key];

	return sorted satisfies JsonObject;
}

const canvasKey = (snapshot: Snapshot) =>
	JSON.stringify(
		{
			frames: snapshot.frames,
			comments: snapshot.comments ?? [],
			theme: snapshot.theme ?? null,
			name: snapshot.name ?? null,
			device: snapshot.device ?? null,
			locks: snapshot.locks ?? [],
			sections: snapshot.sections ?? [],
			images: snapshot.images ?? [],
		},
		sortKeys,
	);

export const sameCanvas = (a: Snapshot, b: Snapshot) => canvasKey(a) === canvasKey(b);

export type Resumed = { history: History; dropped: boolean };

export function resumeHistory(saved: History, disk: Snapshot, reconcile: (snapshot: Snapshot) => Snapshot): Resumed {
	const withFiles = rebase(saved, diffFiles(saved.present.files, disk.files), reconcile);
	const rebased = rebaseCanvas(withFiles, withFiles.present, disk, reconcile);

	if (sameCanvas(rebased.present, disk))
		return { history: { ...rebased, present: disk, coalesceKey: null }, dropped: false };

	return { history: createHistory(disk), dropped: canUndo(saved) || canRedo(saved) };
}
