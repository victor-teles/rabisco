import { isModeSlug, SCHEME, type ResolvedMode } from "../../shared/modes";

const PREFIX = "data-mode-";

type ModeRoot = {
	classList: { toggle: (name: string, force: boolean) => boolean };
	attributes: Iterable<{ name: string }>;
	setAttribute: (name: string, value: string) => void;
	removeAttribute: (name: string) => void;
};

export function applyMode(root: ModeRoot, mode: ResolvedMode) {
	root.classList.toggle("dark", mode[SCHEME] === "dark");
	const kept = new Set<string>();

	for (const [group, option] of Object.entries(mode)) {
		if (group === SCHEME || !isModeSlug(group) || !isModeSlug(option)) continue;
		kept.add(PREFIX + group);
		root.setAttribute(PREFIX + group, option);
	}

	for (const { name } of Array.from(root.attributes)) {
		if (name.startsWith(PREFIX) && !kept.has(name)) root.removeAttribute(name);
	}
}
