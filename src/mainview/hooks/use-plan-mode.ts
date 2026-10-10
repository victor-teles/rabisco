import { useSyncExternalStore } from "react";

const STORAGE_KEY = "rabisco:plan-mode";

export const PLAN_MODE_KEYS = "⇧⌘P";

export const isPlanModeToggle = (event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">) =>
	event.code === "KeyP" && (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey;

export const parsePlanMode = (stored: string | null) => stored === "1";

export function planModeHint({ editing, variations }: { editing: number; variations: number }) {
	if (editing) return "Prompts edit the selection, so they aren't planned. Deselect to plan new screens.";

	if (variations > 1) return "Variations run without a plan. Pick 1 version to plan first.";

	return undefined;
}

const listeners = new Set<() => void>();

function read() {
	try {
		return parsePlanMode(localStorage.getItem(STORAGE_KEY));
	} catch {
		return false;
	}
}

let current = read();

export const planMode = () => current;

export function setPlanMode(next: boolean) {
	current = next;

	try {
		localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
	} catch {}

	for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);

	return () => listeners.delete(listener);
};

export function usePlanMode(): [boolean, (next: boolean) => void] {
	return [useSyncExternalStore(subscribe, planMode), setPlanMode];
}
