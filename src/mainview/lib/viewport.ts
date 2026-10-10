import { useSyncExternalStore } from "react";

export type Viewport = { x: number; y: number; zoom: number };

/** Outside React state, so pan and zoom don't re-render the editor; the canvas writes it to the DOM per frame */
export type ViewportStore = {
	get: () => Viewport;
	set: (next: Viewport) => void;
	subscribe: (listener: () => void) => () => void;
};

export function viewportStore(initial: Viewport): ViewportStore {
	let current = initial;
	const listeners = new Set<() => void>();

	return {
		get: () => current,
		set(next) {
			if (next.x === current.x && next.y === current.y && next.zoom === current.zoom) return;
			current = next;

			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);

			return () => listeners.delete(listener);
		},
	};
}

/** Re-renders only when the rounded percentage changes, not on pan */
export function useZoomPercent(store: ViewportStore) {
	return useSyncExternalStore(store.subscribe, () => Math.round(store.get().zoom * 100));
}
