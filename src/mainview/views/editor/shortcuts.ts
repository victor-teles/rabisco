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

export const CODE_VIEW_KEYS = "⇧D";

export const CONTEXT_VIEW_KEYS = "⇧C";

export const COMPARE_KEYS = "⇧V";

/** Figma's Assets panel: ⌥2. Matched on `event.code` (`Digit2`) since ⌥ changes `event.key` on macOS */
export const COMPONENTS_VIEW_KEYS = "⌥2";

export const COMPONENTS_VIEW_CODE = "Digit2";

export const MAKE_COMPONENT_KEYS = "⌥⌘K";

/** ⌥⌘K (⌃⌥K off macOS), matched on `event.code` since ⌥ changes `event.key` */
export const isMakeComponent = (event: KeyboardEvent | React.KeyboardEvent) =>
	event.code === "KeyK" && event.altKey && (event.metaKey || event.ctrlKey) && !event.shiftKey;

export function isTyping(target: EventTarget | null) {
	return (
		target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
	);
}

const CONTROL =
	"button, a[href], [role=button], [role=checkbox], [role=combobox], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], [role=radio], [role=separator], [role=slider], [role=switch], [role=tab]";

const PANEL = "aside, [role=dialog], [role=menu], [data-radix-popper-content-wrapper]";

/** The slice of `Element` the check reads, so it runs without a DOM */
export type KeyTarget = {
	tagName: string;
	isContentEditable?: boolean;
	closest: (selector: string) => KeyTarget | null;
};

type Modifiers = { metaKey: boolean; ctrlKey: boolean; altKey: boolean };

/**
 * Whether the focused element keeps a key from the canvas shortcuts. Text fields own every key; buttons and
 * other controls in a panel or popover own the plain ones (⌫, arrows, Space), so ⌘Z still works from them.
 */
export function ownsKey(target: KeyTarget | null, modifiers: Modifiers) {
	if (!target) return false;

	if (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName)) return true;

	if (modifiers.metaKey || modifiers.ctrlKey || modifiers.altKey) return false;

	return Boolean(target.closest(CONTROL)?.closest(PANEL));
}

export const focusOwnsKey = (event: KeyboardEvent) =>
	ownsKey(event.target instanceof HTMLElement ? event.target : null, event);

/** Keys the focused structure tree consumes, so they never reach the editor's global handler (nudge, delete screen). */
export const treeOwnsKey = (key: string) => key.startsWith("Arrow") || key === "Backspace" || key === "Delete";

export const PLAY_KEYS = "⌥⌘↵";

/** ⌥⌘↵ (⌃⌥↵ off macOS) */
export const isPlay = (event: KeyboardEvent | React.KeyboardEvent) =>
	event.key === "Enter" && event.altKey && (event.metaKey || event.ctrlKey) && !event.shiftKey;

export const PLAY_BACK_KEYS = "⌘[";

export const PLAY_FORWARD_KEYS = "⌘]";
