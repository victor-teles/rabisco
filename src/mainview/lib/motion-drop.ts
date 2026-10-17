// A motion preset dragged from the catalog onto an element (decision 0027). WebKit hides custom drag types from
// `dragover` on `views://`, so the canvas reads the active drag from here, as it does for components.

export const MOTION_MIME = "application/x-rabisco-motion";

let activePreset: string | null = null;

const listeners = new Set<() => void>();

const setPreset = (next: string | null) => {
	if (next === activePreset) return;
	activePreset = next;

	for (const listener of listeners) listener();
};

export const motionDrag = {
	start: (preset: string) => setPreset(preset),
	end: () => setPreset(null),
	/** The preset's id */
	current: () => activePreset,
	subscribe: (listener: () => void) => {
		listeners.add(listener);

		return () => void listeners.delete(listener);
	},
};
