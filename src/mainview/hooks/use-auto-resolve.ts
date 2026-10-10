import { useSyncExternalStore } from "react";

const STORAGE_KEY = "rabisco:comments:auto-resolve";

const listeners = new Set<() => void>();

/** On unless turned off */
function read() {
	try {
		return localStorage.getItem(STORAGE_KEY) !== "0";
	} catch {
		return true;
	}
}

let current = read();

export function setAutoResolve(next: boolean) {
	current = next;

	try {
		localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
	} catch {
		// Private mode: the choice lasts for this session
	}

	for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);

	return () => listeners.delete(listener);
};

/** Whether comments sent to the chat are resolved once the AI changes the design for them */
export function useAutoResolve(): [boolean, (next: boolean) => void] {
	return [useSyncExternalStore(subscribe, () => current), setAutoResolve];
}
