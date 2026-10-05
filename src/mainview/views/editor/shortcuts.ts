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

/** PRODUCT.md and DESIGN.md: C for context, next to ⇧D */
export const CONTEXT_VIEW_KEYS = "⇧C";

/** Compare the selected screen's variations. Figma has no compare; V for variations, beside ⇧D and ⇧C */
export const COMPARE_KEYS = "⇧V";

/** Figma's Assets panel: ⌥2. Matched on `event.code` (`Digit2`) since ⌥ changes `event.key` on macOS */
export const COMPONENTS_VIEW_KEYS = "⌥2";

export const COMPONENTS_VIEW_CODE = "Digit2";

/** Figma's create-component shortcut: make the selected structure a component */
export const MAKE_COMPONENT_KEYS = "⌥⌘K";

/** ⌥⌘K (⌃⌥K off macOS), matched on `event.code` since ⌥ changes `event.key` */
export const isMakeComponent = (event: KeyboardEvent | React.KeyboardEvent) =>
	event.code === "KeyK" && event.altKey && (event.metaKey || event.ctrlKey) && !event.shiftKey;

export function isTyping(target: EventTarget | null) {
	return (
		target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
	);
}

/** Keys the focused structure tree consumes, so they never reach the editor's global handler (nudge, delete screen). */
export const treeOwnsKey = (key: string) => key.startsWith("Arrow") || key === "Backspace" || key === "Delete";

/** Figma's Present shortcut: play the prototype from the selected screen */
export const PLAY_KEYS = "⌥⌘↵";

/** ⌥⌘↵ (⌃⌥↵ off macOS) */
export const isPlay = (event: KeyboardEvent | React.KeyboardEvent) =>
	event.key === "Enter" && event.altKey && (event.metaKey || event.ctrlKey) && !event.shiftKey;

/** Back and forward in play mode, as in a browser */
export const PLAY_BACK_KEYS = "⌘[";

export const PLAY_FORWARD_KEYS = "⌘]";
