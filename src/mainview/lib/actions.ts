/** One key combination. `mod` is ⌘ on macOS and Ctrl elsewhere */
export type Chord = {
	/** `event.code`, for keys that ⌥ or ⇧ change on macOS */
	code?: string;
	/** `event.key`, for symbols and named keys */
	key?: string;
	mod?: boolean;
	/** The literal ⌃ key, for Figma's ⌃⌥ shortcuts */
	ctrl?: boolean;
	alt?: boolean;
	/** Unset means ⇧ must be up; `"any"` ignores it */
	shift?: boolean | "any";
};

export type Action = {
	id: string;
	label: string;
	/** Heading in the command palette and the shortcut sheet */
	group: string;
	/** The first one is the one shown */
	chords?: Chord[];
	enabled: boolean;
	destructive?: boolean;
	/** Keys only: left out of the command palette */
	hidden?: boolean;
	/** Its keys work from text fields too, so they need ⌘ and can't be typing */
	global?: boolean;
	/** While disabled, its keys reach the page: Tab moves focus when no element is selected */
	passive?: boolean;
	run: () => void;
};

export type KeyInput = Pick<KeyboardEvent, "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function matchesChord(chord: Chord, event: KeyInput) {
	const hit = chord.code !== undefined ? event.code === chord.code : event.key === chord.key;

	if (!hit) return false;

	if (chord.ctrl) {
		if (!event.ctrlKey || event.metaKey) return false;
	} else if (chord.mod) {
		if (!event.metaKey && !event.ctrlKey) return false;
	} else if (event.metaKey || event.ctrlKey) return false;

	if (Boolean(chord.alt) !== event.altKey) return false;

	return chord.shift === "any" || Boolean(chord.shift) === event.shiftKey;
}

/** The first enabled action bound to the keys, else the first disabled one that isn't passive, so its keys still don't reach the page */
export function actionForKey(actions: readonly Action[], event: KeyInput) {
	let disabled: Action | undefined;

	for (const action of actions) {
		if (!action.chords?.some((chord) => matchesChord(chord, event))) continue;

		if (action.enabled) return action;

		if (!action.passive) disabled ??= action;
	}

	return disabled;
}

const KEY_LABELS = new Map([
	["Backspace", "⌫"],
	["Delete", "⌦"],
	["Enter", "↵"],
	["Escape", "Esc"],
	["Tab", "⇥"],
	["ArrowUp", "↑"],
	["ArrowDown", "↓"],
	["ArrowLeft", "←"],
	["ArrowRight", "→"],
	["=", "+"],
]);

function keyLabel(chord: Chord) {
	const code = chord.code ?? "";
	const named = /^(?:Key|Digit)(.)$/.exec(code)?.[1];

	if (named) return named;
	const key = chord.key ?? code;

	return KEY_LABELS.get(key) ?? key.toUpperCase();
}

/** In macOS order: ⌃⌥⇧⌘ */
export function formatChord(chord: Chord) {
	return `${chord.ctrl ? "⌃" : ""}${chord.alt ? "⌥" : ""}${chord.shift === true ? "⇧" : ""}${chord.mod ? "⌘" : ""}${keyLabel(chord)}`;
}

export const shortcutOf = (action: Action) => (action.chords?.[0] ? formatChord(action.chords[0]) : undefined);

export const actionById = (actions: readonly Action[], id: string) => actions.find((action) => action.id === id);
