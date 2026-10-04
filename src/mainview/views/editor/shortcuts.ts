import type { Alignment, Axis } from "@/lib/align";

/** Figma's align shortcuts: ⌥ + key, matched on `event.code` since ⌥ changes `event.key` on macOS. */
export const ALIGN_SHORTCUTS: { alignment: Alignment; label: string; code: string; keys: string }[] = [
	{ alignment: "left", label: "Align left", code: "KeyA", keys: "⌥A" },
	{ alignment: "h-center", label: "Align horizontal centers", code: "KeyH", keys: "⌥H" },
	{ alignment: "right", label: "Align right", code: "KeyD", keys: "⌥D" },
	{ alignment: "top", label: "Align top", code: "KeyW", keys: "⌥W" },
	{ alignment: "v-middle", label: "Align vertical centers", code: "KeyV", keys: "⌥V" },
	{ alignment: "bottom", label: "Align bottom", code: "KeyS", keys: "⌥S" },
];

/** ⌃⌥H / ⌃⌥V, as in Figma */
export const DISTRIBUTE_SHORTCUTS: { axis: Axis; label: string; code: string; keys: string }[] = [
	{ axis: "horizontal", label: "Distribute horizontal spacing", code: "KeyH", keys: "⌃⌥H" },
	{ axis: "vertical", label: "Distribute vertical spacing", code: "KeyV", keys: "⌃⌥V" },
];

/** Figma's Dev Mode toggle, the closest convention for "show me the code" */
export const CODE_VIEW_KEYS = "⇧D";

export function isTyping(target: EventTarget | null) {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
	);
}
