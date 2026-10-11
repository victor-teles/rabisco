import type { Viewport, ViewportStore } from "@/lib/viewport";
import { isFiniteNumber, isString } from "../../shared/guards";
import { isJsonArray, isJsonObject, type Json } from "../../shared/json";

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type LastProject = { path: string; chatId: string | null };

export type SavedViewport = { path: string; viewport: Viewport };

const LAST_PROJECT_KEY = "rabisco:last-project";

const VIEWPORTS_KEY = "rabisco:viewports";

export const VIEWPORT_LIMIT = 50;

export const VIEWPORT_SAVE_MS = 500;

function readJson(store: KeyValueStore, key: string): Json | undefined {
	try {
		const text = store.getItem(key);

		// SAFETY: JSON.parse without a reviver only produces strings, numbers, booleans, null, arrays and plain objects
		return text === null ? undefined : (JSON.parse(text) as Json);
	} catch {
		return undefined;
	}
}

function writeJson(store: KeyValueStore, key: string, value: LastProject | SavedViewport[]) {
	try {
		store.setItem(key, JSON.stringify(value));
	} catch (error) {
		console.warn(`Could not remember ${key}:`, error);
	}
}

export function parseViewport(value: Json | undefined): Viewport | null {
	if (!isJsonObject(value)) return null;
	const { x, y, zoom } = value;

	if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom) || zoom <= 0) return null;

	return { x, y, zoom };
}

export function parseLastProject(value: Json | undefined): LastProject | null {
	if (!isJsonObject(value) || !isString(value.path) || !value.path) return null;

	return { path: value.path, chatId: isString(value.chatId) ? value.chatId : null };
}

export function parseViewports(value: Json | undefined): SavedViewport[] {
	if (!isJsonArray(value)) return [];
	const saved: SavedViewport[] = [];

	for (const entry of value) {
		const viewport = isJsonObject(entry) ? parseViewport(entry.viewport) : null;

		if (viewport && isJsonObject(entry) && isString(entry.path)) saved.push({ path: entry.path, viewport });
	}

	return saved;
}

export function withViewport(
	saved: SavedViewport[],
	path: string,
	viewport: Viewport,
	limit = VIEWPORT_LIMIT,
): SavedViewport[] {
	return [{ path, viewport }, ...saved.filter((entry) => entry.path !== path)].slice(0, limit);
}

export const readLastProject = (store: KeyValueStore) => parseLastProject(readJson(store, LAST_PROJECT_KEY));

export const rememberProject = (store: KeyValueStore, project: LastProject) =>
	writeJson(store, LAST_PROJECT_KEY, project);

export function forgetProject(store: KeyValueStore) {
	try {
		store.removeItem(LAST_PROJECT_KEY);
	} catch (error) {
		console.warn("Could not forget the last project:", error);
	}
}

export const savedViewport = (store: KeyValueStore, path: string) =>
	parseViewports(readJson(store, VIEWPORTS_KEY)).find((entry) => entry.path === path)?.viewport ?? null;

export function rememberViewport(store: KeyValueStore, path: string, viewport: Viewport) {
	writeJson(store, VIEWPORTS_KEY, withViewport(parseViewports(readJson(store, VIEWPORTS_KEY)), path, viewport));
}

export function persistViewport(path: string, viewport: ViewportStore, store: KeyValueStore, delay = VIEWPORT_SAVE_MS) {
	let timer: ReturnType<typeof setTimeout> | undefined;

	const save = () => {
		timer = undefined;
		rememberViewport(store, path, viewport.get());
	};

	const unsubscribe = viewport.subscribe(() => {
		clearTimeout(timer);
		timer = setTimeout(save, delay);
	});

	return () => {
		unsubscribe();

		if (timer !== undefined) {
			clearTimeout(timer);
			save();
		}
	};
}
