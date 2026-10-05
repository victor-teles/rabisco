import { useSyncExternalStore } from "react";
import { clampVariations } from "@/lib/variations";

/** How many variations a create generates. One preference for every composer, kept in localStorage like the theme. */

const STORAGE_KEY = "rabisco:variations";
const listeners = new Set<() => void>();

function read() {
	try {
		return clampVariations(localStorage.getItem(STORAGE_KEY));
	} catch {
		return 1;
	}
}

let current = read();

export function setVariations(next: number) {
	current = clampVariations(next);
	try {
		localStorage.setItem(STORAGE_KEY, String(current));
	} catch {
		// Private mode: the choice lasts for this session
	}
	for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export function useVariations(): [number, (next: number) => void] {
	return [useSyncExternalStore(subscribe, () => current), setVariations];
}
