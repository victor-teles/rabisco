import { describe, expect, test } from "bun:test";
import { isControlClick, isDeepModifier } from "./platform";

describe("isControlClick", () => {
	test("a ⌃ + primary press is a right-click on macOS only", () => {
		expect(isControlClick({ button: 0, ctrlKey: true }, true)).toBe(true);
		expect(isControlClick({ button: 0, ctrlKey: true }, false)).toBe(false);
	});

	test("a plain press or another button is not", () => {
		expect(isControlClick({ button: 0, ctrlKey: false }, true)).toBe(false);
		expect(isControlClick({ button: 1, ctrlKey: true }, true)).toBe(false);
	});
});

describe("isDeepModifier", () => {
	test("⌘ reaches in everywhere, Ctrl only off macOS", () => {
		expect(isDeepModifier({ metaKey: true, ctrlKey: false }, true)).toBe(true);
		expect(isDeepModifier({ metaKey: false, ctrlKey: true }, true)).toBe(false);
		expect(isDeepModifier({ metaKey: false, ctrlKey: true }, false)).toBe(true);
	});
});
