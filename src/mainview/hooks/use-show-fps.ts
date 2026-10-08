import { useSyncExternalStore } from "react";
import { isDevelopment } from "@/lib/dev";

const STORAGE_KEY = "rabisco:debug:fps";

const listeners = new Set<() => void>();

function read() {
	try {
		return isDevelopment && localStorage.getItem(STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

let current = read();

export function setShowFps(next: boolean) {
	current = isDevelopment && next;

	try {
		localStorage.setItem(STORAGE_KEY, current ? "1" : "0");
	} catch {
		// Private mode: the choice lasts for this session
	}

	for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);

	return () => void listeners.delete(listener);
};

/** Development only: always false in stable and canary builds */
export function useShowFps() {
	return useSyncExternalStore(subscribe, () => current);
}
