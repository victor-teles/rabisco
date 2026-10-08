import { describe, expect, test } from "bun:test";
import { type Action, actionForKey, type Chord, formatChord, type KeyInput, matchesChord } from "./actions";

const press = (input: Partial<KeyInput>): KeyInput => ({
	code: "",
	key: "",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	...input,
});

const action = (id: string, chords: Chord[], enabled = true): Action => ({
	id,
	label: id,
	group: "Test",
	chords,
	enabled,
	run: () => {},
});

describe("matchesChord", () => {
	test("⌘ chords take ⌘ or Ctrl, and nothing else", () => {
		const duplicate: Chord = { code: "KeyD", mod: true };

		expect(matchesChord(duplicate, press({ code: "KeyD", metaKey: true }))).toBe(true);
		expect(matchesChord(duplicate, press({ code: "KeyD", ctrlKey: true }))).toBe(true);
		expect(matchesChord(duplicate, press({ code: "KeyD" }))).toBe(false);
		expect(matchesChord(duplicate, press({ code: "KeyD", metaKey: true, shiftKey: true }))).toBe(false);
		expect(matchesChord(duplicate, press({ code: "KeyD", metaKey: true, altKey: true }))).toBe(false);
	});

	test("plain keys don't fire with ⌘ or Ctrl held", () => {
		const move: Chord = { key: "v" };

		expect(matchesChord(move, press({ key: "v" }))).toBe(true);
		expect(matchesChord(move, press({ key: "v", metaKey: true }))).toBe(false);
		expect(matchesChord(move, press({ key: "v", ctrlKey: true }))).toBe(false);
	});

	test("⌃⌥ chords need the real ⌃, not ⌘", () => {
		const distribute: Chord = { code: "KeyH", ctrl: true, alt: true };

		expect(matchesChord(distribute, press({ code: "KeyH", ctrlKey: true, altKey: true }))).toBe(true);
		expect(matchesChord(distribute, press({ code: "KeyH", metaKey: true, altKey: true }))).toBe(false);
		expect(matchesChord(distribute, press({ code: "KeyH", altKey: true }))).toBe(false);
	});

	test('shift "any" ignores ⇧, for symbols like +', () => {
		const zoomIn: Chord = { key: "+", mod: true, shift: "any" };

		expect(matchesChord(zoomIn, press({ key: "+", metaKey: true, shiftKey: true }))).toBe(true);
		expect(matchesChord(zoomIn, press({ key: "+", metaKey: true }))).toBe(true);
	});
});

describe("actionForKey", () => {
	test("a disabled passive action lets its keys through, so Tab still moves focus", () => {
		const next = { ...action("select-next", [{ key: "Tab" }], false), passive: true };

		expect(actionForKey([next], press({ key: "Tab" }))).toBeUndefined();
		expect(actionForKey([{ ...next, enabled: true }], press({ key: "Tab" }))?.id).toBe("select-next");
		expect(formatChord({ key: "Tab", shift: true })).toBe("⇧⇥");
	});

	test("picks the enabled action when two share keys", () => {
		const deleteElement = action("delete-element", [{ key: "Backspace" }], false);
		const deleteScreens = action("delete-screens", [{ key: "Backspace" }]);

		expect(actionForKey([deleteElement, deleteScreens], press({ key: "Backspace" }))?.id).toBe("delete-screens");
	});

	test("returns a disabled action when it's the only match, so its keys are still consumed", () => {
		const duplicate = action("duplicate", [{ code: "KeyD", mod: true }], false);

		expect(actionForKey([duplicate], press({ code: "KeyD", metaKey: true }))?.id).toBe("duplicate");
		expect(actionForKey([duplicate], press({ code: "KeyX", metaKey: true }))).toBeUndefined();
	});
});

describe("formatChord", () => {
	test("orders modifiers as macOS does", () => {
		expect(formatChord({ code: "KeyZ", mod: true, shift: true })).toBe("⇧⌘Z");
		expect(formatChord({ code: "KeyK", mod: true, alt: true })).toBe("⌥⌘K");
		expect(formatChord({ code: "KeyH", ctrl: true, alt: true })).toBe("⌃⌥H");
		expect(formatChord({ code: "Digit1", shift: true })).toBe("⇧1");
		expect(formatChord({ key: "Backspace" })).toBe("⌫");
		expect(formatChord({ key: "Enter", mod: true, alt: true })).toBe("⌥⌘↵");
		expect(formatChord({ key: "=", mod: true })).toBe("⌘+");
		expect(formatChord({ key: "v" })).toBe("V");
	});
});
