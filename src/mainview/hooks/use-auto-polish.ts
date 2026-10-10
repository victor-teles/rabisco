import { useSyncExternalStore } from "react";
import { polishModeOf } from "../../shared/design/polish";

const STORAGE_KEY = "rabisco:generation:auto-polish";

const REVIEW_KEY = "rabisco:generation:auto-review";

function read(key: string) {
	try {
		return localStorage.getItem(key) !== "0";
	} catch {
		return true;
	}
}

function toggle(key: string) {
	const listeners = new Set<() => void>();
	let current = read(key);

	const set = (next: boolean) => {
		current = next;

		try {
			localStorage.setItem(key, next ? "1" : "0");
		} catch {}

		for (const listener of listeners) listener();
	};

	const subscribe = (listener: () => void) => {
		listeners.add(listener);

		return () => listeners.delete(listener);
	};

	return { get: () => current, set, subscribe };
}

const polish = toggle(STORAGE_KEY);

const review = toggle(REVIEW_KEY);

export const polishMode = () => polishModeOf(polish.get(), review.get());

export function useAutoPolish(): [boolean, (next: boolean) => void] {
	return [useSyncExternalStore(polish.subscribe, polish.get), polish.set];
}

export function useAutoReview(): [boolean, (next: boolean) => void] {
	return [useSyncExternalStore(review.subscribe, review.get), review.set];
}
