import type { DuplicateGroup } from "../../shared/jsx";

export type SuggestionHover = Pick<DuplicateGroup, "key" | "occurrences" | "suggestedName">;

let hovered: SuggestionHover | null = null;

const listeners = new Set<() => void>();

export const suggestionHover = {
	current: () => hovered,
	set: (next: SuggestionHover | null) => {
		if (hovered === next) return;
		hovered = next;

		for (const listener of listeners) listener();
	},
	clear: (key: string) => {
		if (hovered?.key === key) suggestionHover.set(null);
	},
	subscribe: (listener: () => void) => {
		listeners.add(listener);

		return () => void listeners.delete(listener);
	},
};
