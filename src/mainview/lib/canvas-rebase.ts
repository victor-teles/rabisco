import type { History, Snapshot } from "@/lib/history";
import { isJsonObject } from "../../shared/json";
import type { Annotation, CanvasComment, CanvasImage, CanvasPage, CanvasSection, Frame } from "../../shared/types";

const canonical = <T>(value: T) =>
	JSON.stringify(value, (_key, inner) =>
		isJsonObject(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b))) : inner,
	);

const same = <T>(a: T, b: T) => a === b || canonical(a) === canonical(b);

type ListChange<T> = { changed: Map<string, T>; removed: Set<string>; added: T[] };

function diffList<T>(from: T[], to: T[], key: (item: T) => string): ListChange<T> | null {
	const before = new Map(from.map((item) => [key(item), item]));
	const after = new Map(to.map((item) => [key(item), item]));
	const changed = new Map<string, T>();
	const removed = new Set<string>();
	const added: T[] = [];

	for (const [id, item] of after) {
		const old = before.get(id);

		if (old === undefined) added.push(item);
		else if (!same(old, item)) changed.set(id, item);
	}

	for (const id of before.keys()) if (!after.has(id)) removed.add(id);

	return changed.size || removed.size || added.length ? { changed, removed, added } : null;
}

function foldList<T>(list: T[], change: ListChange<T>, key: (item: T) => string): T[] {
	const present = new Set(list.map(key));
	const kept: T[] = [];

	for (const item of list) {
		const id = key(item);

		if (!change.removed.has(id)) kept.push(change.changed.get(id) ?? item);
	}

	for (const item of change.added) if (!present.has(key(item))) kept.push(item);

	return kept;
}

type CanvasFields = Omit<Snapshot, "files">;

const byFile = (frame: Frame) => frame.file;

const byId = (item: CanvasComment | CanvasSection | CanvasImage | Annotation | CanvasPage) => item.id;

export function rebaseCanvas(
	history: History,
	from: CanvasFields,
	to: CanvasFields,
	reconcile: (snapshot: Snapshot) => Snapshot = (snapshot) => snapshot,
): History {
	const frames = diffList(from.frames, to.frames, byFile);
	const comments = diffList(from.comments ?? [], to.comments ?? [], byId);
	const sections = diffList(from.sections ?? [], to.sections ?? [], byId);
	const images = diffList(from.images ?? [], to.images ?? [], byId);
	const annotations = diffList(from.annotations ?? [], to.annotations ?? [], byId);
	const pages = !same(from.pages ?? [], to.pages ?? []);
	const name = from.name !== to.name;
	const device = from.device !== to.device;
	const theme = !same(from.theme, to.theme);
	const locks = !same(from.locks, to.locks);

	if (!frames && !comments && !sections && !images && !annotations && !pages && !name && !device && !theme && !locks)
		return history;

	const fold = (snapshot: Snapshot): Snapshot => {
		const next: Snapshot = { ...snapshot };

		if (frames) next.frames = foldList(snapshot.frames, frames, byFile);

		if (comments) next.comments = foldList(snapshot.comments ?? [], comments, byId);

		if (sections) next.sections = foldList(snapshot.sections ?? [], sections, byId);

		if (images) next.images = foldList(snapshot.images ?? [], images, byId);

		if (annotations) next.annotations = foldList(snapshot.annotations ?? [], annotations, byId);

		if (pages) next.pages = to.pages ?? [];

		if (name) next.name = to.name;

		if (device) next.device = to.device;

		if (theme) next.theme = to.theme;

		if (locks) next.locks = to.locks;

		return reconcile(next);
	};

	return {
		past: history.past.map(fold),
		present: fold(history.present),
		future: history.future.map(fold),
		coalesceKey: null,
	};
}
