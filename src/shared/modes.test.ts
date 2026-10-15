import { describe, expect, test } from "bun:test";
import {
	chooseMode,
	DEFAULT_MODE,
	defaultMode,
	draftedSections,
	inheritedModes,
	modeKey,
	modeLabel,
	normalizeDraft,
	normalizeModes,
	normalizeTokenModes,
	resolveDraft,
	resolveModes,
	setDraftToken,
	targetModes,
} from "./modes";
import type { DesignTokens } from "./context/tokens";
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

const NONE: DesignTokens = { light: {}, dark: {} };

const outer = section("outer", 0, 0, 1000, { scheme: "dark" });

const inner = section("inner", 0, 0, 400, { scheme: "light" });

describe("resolveModes", () => {
	test("a screen outside every section gets the defaults", () => {
		expect(resolveModes(frame(2000, 2000), [outer], NONE)).toEqual({ scheme: "light" });
		expect(resolveModes(frame(2000, 2000), [outer], NONE)).toBe(DEFAULT_MODE);
	});

	test("a screen inside a dark section is dark", () => {
		expect(resolveModes(frame(600, 600), [outer], NONE)).toEqual({ scheme: "dark" });
	});

	test("the smallest section around the screen's center wins", () => {
		expect(resolveModes(frame(100, 100), [outer, inner], NONE)).toEqual({ scheme: "light" });
		expect(resolveModes(frame(100, 100), [inner, outer], NONE)).toEqual({ scheme: "light" });
	});

	test("a nested section without a choice inherits from the larger one", () => {
		const plain = section("plain", 0, 0, 400);
		expect(resolveModes(frame(100, 100), [outer, plain], NONE)).toEqual({ scheme: "dark" });
	});

	test("the screen's own choice beats its sections", () => {
		expect(resolveModes(frame(600, 600, { scheme: "light" }), [outer], NONE)).toEqual({ scheme: "light" });
	});

	test("a choice naming an option that doesn't exist is skipped", () => {
		expect(resolveModes(frame(600, 600, { scheme: "dim" }), [outer], NONE)).toEqual({ scheme: "dark" });
	});

	test("every group gets an option, its first one by default", () => {
		const theme: DesignTokens = {
			light: {},
			dark: {},
			modes: [
				{
					name: "brand",
					options: [
						{ name: "base", light: {}, dark: {} },
						{ name: "acme", light: {}, dark: {} },
					],
				},
			],
		};

		expect(resolveModes(frame(600, 600, { brand: "acme" }), [], theme)).toEqual({ scheme: "light", brand: "acme" });
		expect(resolveModes(frame(600, 600, { brand: "gone" }), [], theme)).toEqual({ scheme: "light", brand: "base" });
		expect(resolveModes(frame(600, 600, { brand: "acme" }), [], NONE)).toEqual({ scheme: "light" });
		expect(defaultMode(theme)).toEqual({ scheme: "light", brand: "base" });
	});

	test("the same mode is the same object, so memoized views keep their props", () => {
		expect(resolveModes(frame(600, 600), [outer], NONE)).toBe(resolveModes(frame(700, 700), [outer], NONE));
	});
});

test("targetModes resolves the targets that have a frame", () => {
	const frames = [{ ...frame(500, 500), file: "screens/b.tsx" }, frame(2000, 2000)];

	expect(targetModes(["screens/b.tsx", "screens/a.tsx", "screens/new.tsx"], frames, [outer, inner], NONE)).toEqual({
		"screens/b.tsx": { scheme: "dark" },
		"screens/a.tsx": { scheme: "light" },
	});
	expect(targetModes(["screens/new.tsx"], frames, [outer], NONE)).toBeUndefined();
});

describe("inheritedModes", () => {
	test("a section inherits from the larger sections around it, not from smaller ones or itself", () => {
		expect(inheritedModes(inner, [outer, inner], NONE)).toEqual({ scheme: "dark" });
		expect(inheritedModes(outer, [outer, inner], NONE)).toEqual({ scheme: "light" });
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

test("normalizeTokenModes keeps slug groups and options with valid values", () => {
	expect(
		normalizeTokenModes([
			{ name: "brand", options: [{ name: "acme", light: { primary: "#f00", bad: "x" }, dark: { primary: "red;}" } }] },
			{ name: "brand", options: [{ name: "again", light: {}, dark: {} }] },
			{ name: "scheme", options: [{ name: "dim", light: {}, dark: {} }] },
			{ name: "Tone", options: [{ name: "warm", light: {}, dark: {} }] },
			{ name: "empty", options: [] },
		]),
	).toEqual([{ name: "brand", options: [{ name: "acme", light: { primary: "#f00" }, dark: {} }] }]);
	expect(normalizeTokenModes(undefined)).toBeUndefined();
});

describe("section drafts", () => {
	const drafted = (made: CanvasSection, tokens: CanvasSection["tokens"]): CanvasSection => ({ ...made, tokens });

	test("a screen gets the draft of the sections around it, the smallest winning", () => {
		const sections = [
			drafted(outer, { light: { primary: "#111", accent: "#222" }, dark: {} }),
			drafted(inner, { light: { primary: "#333" }, dark: { primary: "#444" } }),
		];

		expect(resolveDraft(frame(10, 10), sections)).toEqual({
			light: { primary: "#333", accent: "#222" },
			dark: { primary: "#444" },
		});
		expect(resolveDraft(frame(600, 600), sections)).toEqual({ light: { primary: "#111", accent: "#222" }, dark: {} });
		expect(resolveDraft(frame(5000, 5000), sections)).toBeUndefined();
	});

	test("one draft is passed through as it is", () => {
		const tokens = { light: { primary: "#111" }, dark: {} };

		expect(resolveDraft(frame(10, 10), [outer, drafted(inner, tokens)])).toBe(tokens);
	});

	test("setting the last value away clears the draft", () => {
		const one = setDraftToken(undefined, "dark", "primary", "#000");

		expect(one).toEqual({ light: {}, dark: { primary: "#000" } });
		expect(setDraftToken(one, "dark", "primary", null)).toBeUndefined();
	});

	test("loads from rabisco.json without invalid values and counts drafted sections", () => {
		expect(normalizeDraft({ light: { primary: "#111", radius: "red; }" }, dark: "nope" })).toEqual({
			light: { primary: "#111" },
			dark: {},
		});
		expect(normalizeDraft({ light: {}, dark: {} })).toBeUndefined();

		const [loaded] = normalizeSections([{ ...outer, tokens: { light: { primary: "#111" } } }]);

		expect(loaded?.tokens).toEqual({ light: { primary: "#111" }, dark: {} });
		expect(draftedSections([loaded!, inner])).toBe(1);
	});
});
