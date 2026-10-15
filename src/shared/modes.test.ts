import { describe, expect, test } from "bun:test";
import {
	chooseMode,
	DEFAULT_MODE,
	inheritedModes,
	modeKey,
	modeLabel,
	normalizeModes,
	resolveModes,
	type ModeGroup,
} from "./modes";
import { normalizeSections } from "./sections";
import type { CanvasSection, Frame } from "./types";

function frame(x: number, y: number, modes?: Frame["modes"]): Frame {
	const made: Frame = { file: "screens/a.tsx", name: "A", device: "mobile", x, y, width: 100, height: 100 };

	if (modes) made.modes = modes;

	return made;
}

function section(id: string, x: number, y: number, size: number, modes?: CanvasSection["modes"]): CanvasSection {
	const made: CanvasSection = { id, name: id, color: "gray", x, y, width: size, height: size };

	if (modes) made.modes = modes;

	return made;
}

const outer = section("outer", 0, 0, 1000, { scheme: "dark" });

const inner = section("inner", 0, 0, 400, { scheme: "light" });

describe("resolveModes", () => {
	test("a screen outside every section gets the defaults", () => {
		expect(resolveModes(frame(2000, 2000), [outer])).toEqual({ scheme: "light" });
		expect(resolveModes(frame(2000, 2000), [outer])).toBe(DEFAULT_MODE);
	});

	test("a screen inside a dark section is dark", () => {
		expect(resolveModes(frame(600, 600), [outer])).toEqual({ scheme: "dark" });
	});

	test("the smallest section around the screen's center wins", () => {
		expect(resolveModes(frame(100, 100), [outer, inner])).toEqual({ scheme: "light" });
		expect(resolveModes(frame(100, 100), [inner, outer])).toEqual({ scheme: "light" });
	});

	test("a nested section without a choice inherits from the larger one", () => {
		const plain = section("plain", 0, 0, 400);
		expect(resolveModes(frame(100, 100), [outer, plain])).toEqual({ scheme: "dark" });
	});

	test("the screen's own choice beats its sections", () => {
		expect(resolveModes(frame(600, 600, { scheme: "light" }), [outer])).toEqual({ scheme: "light" });
	});

	test("a choice naming an option that doesn't exist is skipped", () => {
		const groups: ModeGroup[] = [{ name: "scheme", options: ["light", "dark"] }];
		expect(resolveModes(frame(600, 600, { scheme: "dim" }), [outer], groups)).toEqual({ scheme: "dark" });
	});

	test("every group gets an option, its first one by default", () => {
		const groups: ModeGroup[] = [
			{ name: "scheme", options: ["light", "dark"] },
			{ name: "brand", options: ["base", "acme"] },
		];

		expect(resolveModes(frame(600, 600, { brand: "acme" }), [], groups)).toEqual({ scheme: "light", brand: "acme" });
	});

	test("the same mode is the same object, so memoized views keep their props", () => {
		expect(resolveModes(frame(600, 600), [outer])).toBe(resolveModes(frame(700, 700), [outer]));
	});
});

describe("inheritedModes", () => {
	test("a section inherits from the larger sections around it, not from smaller ones or itself", () => {
		expect(inheritedModes(inner, [outer, inner])).toEqual({ scheme: "dark" });
		expect(inheritedModes(outer, [outer, inner])).toEqual({ scheme: "light" });
	});
});

describe("chooseMode", () => {
	test("sets and clears a group's option", () => {
		expect(chooseMode(undefined, "scheme", "dark")).toEqual({ scheme: "dark" });
		expect(chooseMode({ scheme: "dark", brand: "acme" }, "scheme", undefined)).toEqual({ brand: "acme" });
		expect(chooseMode({ scheme: "dark" }, "scheme", undefined)).toBeUndefined();
	});
});

describe("normalizeModes", () => {
	test("keeps slugs and drops anything else", () => {
		expect(normalizeModes({ scheme: "dark", Brand: "acme", density: 3, "x y": "z", tone: "Warm" })).toEqual({
			scheme: "dark",
		});
		expect(normalizeModes({})).toBeUndefined();
		expect(normalizeModes(["dark"])).toBeUndefined();
		expect(normalizeModes(undefined)).toBeUndefined();
	});

	test("sections keep their modes when loaded", () => {
		const [loaded] = normalizeSections([{ ...outer, modes: { scheme: "dark", bad: 1 } }]);
		expect(loaded?.modes).toEqual({ scheme: "dark" });
		expect(normalizeSections([section("plain", 0, 0, 10)])[0]).not.toHaveProperty("modes");
	});
});

test("modeKey and modeLabel", () => {
	expect(modeKey({ scheme: "dark", brand: "acme" })).toBe("scheme=dark&brand=acme");
	expect(modeLabel({ scheme: "dark", brand: "big-sky" })).toBe("Dark, Big sky");
});
