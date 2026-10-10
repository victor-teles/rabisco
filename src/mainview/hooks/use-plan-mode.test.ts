import { expect, test } from "bun:test";
import { isPlanModeToggle, parsePlanMode, planModeHint } from "./use-plan-mode";

const keys = { code: "KeyP", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true };

test("plan mode is off until it is turned on", () => {
	expect(parsePlanMode(null)).toBe(false);
	expect(parsePlanMode("0")).toBe(false);
	expect(parsePlanMode("yes")).toBe(false);
	expect(parsePlanMode("1")).toBe(true);
});

test("⇧⌘P toggles it, ⇧⇥ and ⌘P don't", () => {
	expect(isPlanModeToggle(keys)).toBe(true);
	expect(isPlanModeToggle({ ...keys, metaKey: false, ctrlKey: true })).toBe(true);
	expect(isPlanModeToggle({ ...keys, shiftKey: false })).toBe(false);
	expect(isPlanModeToggle({ ...keys, altKey: true })).toBe(false);
	expect(isPlanModeToggle({ ...keys, code: "Tab", metaKey: false })).toBe(false);
});

test("a hint says why a prompt won't be planned", () => {
	expect(planModeHint({ editing: 0, variations: 1 })).toBeUndefined();
	expect(planModeHint({ editing: 2, variations: 1 })).toContain("selection");
	expect(planModeHint({ editing: 0, variations: 3 })).toContain("Variations");
});
