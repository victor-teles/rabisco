/** `from` says who set it: the canvas outlines a hover from the layers, the layers highlight one from the canvas */
export type ElementHover = { file: string; start: number; from: "canvas" | "layers" };

const same = (a: ElementHover | null, b: ElementHover | null) =>
	a === b || (!!a && !!b && a.file === b.file && a.start === b.start && a.from === b.from);

let hovered: ElementHover | null = null;

const listeners = new Set<() => void>();

/** Outside React state, so a hover re-renders only the canvas and the layers, never the editor */
export const elementHover = {
	current: () => hovered,
	set: (next: ElementHover | null) => {
		if (same(hovered, next)) return;
		hovered = next;

		for (const listener of listeners) listener();
	},
	/** Clears it only if `from` still owns it, so a late leave doesn't wipe the other side's hover */
	clear: (from: ElementHover["from"]) => {
		if (hovered?.from === from) elementHover.set(null);
	},
	subscribe: (listener: () => void) => {
		listeners.add(listener);

		return () => void listeners.delete(listener);
	},
};
