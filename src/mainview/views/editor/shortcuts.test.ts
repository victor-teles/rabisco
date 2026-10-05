import { describe, expect, test } from "bun:test";
import { treeOwnsKey } from "./shortcuts";

describe("treeOwnsKey", () => {
	test("the structure tree keeps ⌫ and arrows from the canvas (delete screen, nudge)", () => {
		for (const key of ["Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])
			expect(treeOwnsKey(key)).toBe(true);

		for (const key of ["Enter", "Escape", "v", "Home"]) expect(treeOwnsKey(key)).toBe(false);
	});
});
