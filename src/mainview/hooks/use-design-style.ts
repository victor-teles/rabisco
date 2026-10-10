import { useSyncExternalStore } from "react";
import { AUTO_STYLE, isStyleId, type StyleChoice, type StyleId } from "../../shared/context/styles";

const STORAGE_KEY = "rabisco:design-style";

/** Stored when the user picks no style, so it isn't read as "never chosen" */
const NONE = "none";

/** A new project starts with a direction unless the user turns it off */
const DEFAULT_STYLE: StyleId = "minimal";

const listeners = new Set<() => void>();

function read(): StyleChoice {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);

		if (stored === NONE) return null;

		if (stored === AUTO_STYLE) return AUTO_STYLE;

		return isStyleId(stored) ? stored : DEFAULT_STYLE;
	} catch {
		return DEFAULT_STYLE;
	}
}

let current = read();

export function setDesignStyle(next: StyleChoice) {
	current = next;

	try {
		localStorage.setItem(STORAGE_KEY, next ?? NONE);
	} catch {
		// Private mode: the choice lasts for this session
	}

	for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);

	return () => listeners.delete(listener);
};

export function useDesignStyle(): [StyleChoice, (next: StyleChoice) => void] {
	return [useSyncExternalStore(subscribe, () => current), setDesignStyle];
}
