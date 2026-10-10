import type { DuplicateGroup } from "../../shared/jsx";

/** A component suggestion the user is looking at: the canvas outlines every copy it would replace */
export type SuggestionHover = Pick<DuplicateGroup, "key" | "occurrences" | "suggestedName">;

let hovered: SuggestionHover | null = null;

const listeners = new Set<() => void>();

/** Outside React state, so a hover re-renders only the canvas, never the editor */
export const suggestionHover = {
	current: () => hovered,
	set: (next: SuggestionHover | null) => {
		if (hovered === next) return;
		hovered = next;

		for (const listener of listeners) listener();
	},
	/** Clears it only if `key` still owns it, so a late leave doesn't wipe the next row's hover */
	clear: (key: string) => {
		if (hovered?.key === key) suggestionHover.set(null);
	},
	subscribe: (listener: () => void) => {
		listeners.add(listener);

		return () => void listeners.delete(listener);
	},
};
