import { useSyncExternalStore } from "react";
import { DEFAULT_KIT, isKitId, type KitId } from "../../shared/components/starter-kits";

const STORAGE_KEY = "rabisco:starter-kit";

const listeners = new Set<() => void>();

function read(): KitId {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);

		return isKitId(stored) ? stored : DEFAULT_KIT;
	} catch {
		return DEFAULT_KIT;
	}
}

let current = read();

export function setStarterKit(next: KitId) {
	current = next;

	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {
		// Private mode: the choice lasts for this session
	}

	for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);

	return () => listeners.delete(listener);
};

export function useStarterKit(): [KitId, (next: KitId) => void] {
	return [useSyncExternalStore(subscribe, () => current), setStarterKit];
}
