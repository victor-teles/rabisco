import { describe, expect, test } from "bun:test";
import { FRAME_GAP, FRAME_SIZE } from "../../shared/project";
import type { Frame } from "../../shared/types";
import { MAX_VARIATIONS } from "../../shared/variations";
import { clampVariations, draftLayout, mixNote, mixPrompt, variantLabel, variationName, varyNote } from "./variations";

const frame = (file: string, name: string): Frame => ({
	file,
	name,
	device: "mobile",
	x: 0,
	y: 0,
	width: 390,
	height: 844,
});

describe("variations (editor)", () => {
	test("clamps counts", () => {
		expect(clampVariations(3)).toBe(3);
		expect(clampVariations("2")).toBe(2);
		expect(clampVariations(0)).toBe(1);
		expect(clampVariations(99)).toBe(MAX_VARIATIONS);
		expect(clampVariations("nope", 2)).toBe(2);
		expect(clampVariations(null)).toBe(1);
	});

	test("names alternates after their screen", () => {
		const frames = [frame("screens/welcome.tsx", "Hello")];
		expect(variationName("screens/welcome.tsx", frames)).toBe("Hello");
		expect(variationName("screens/welcome.alt-1.tsx", frames)).toBe("Hello (alt 1)");
		expect(variationName("screens/sign-in.alt-2.tsx", [])).toBe("Sign in (alt 2)");
	});

	test("labels and notes", () => {
		expect(variantLabel("Reading files")).toBe("Reading files");
		expect(variantLabel("Reading files", 0)).toBe("Reading files");
		expect(variantLabel("Reading files", 1)).toBe("Variation 2 · Reading files");
		expect(varyNote("Welcome", " bolder ")).toBe("Vary Welcome: bolder");
		expect(varyNote("Welcome", "")).toBe("Vary Welcome");
		expect(mixNote("header", "Welcome (alt 1)", "Welcome")).toBe("Mix: header from Welcome (alt 1) into Welcome");
		expect(mixPrompt("header", "Welcome (alt 1)", "screens/welcome.alt-1.tsx")).toContain(
			"Take the header from Welcome (alt 1)",
		);
	});

	test("draft layout: one column per screen, variations below", () => {
		const { width, height } = FRAME_SIZE.mobile;

		const frames = draftLayout(
			["screens/b.alt-1.tsx", "screens/a.tsx", "screens/b.tsx", "screens/a.alt-2.tsx"],
			{},
			"mobile",
		);

		const at = (file: string) => frames.find((f) => f.file === file)!;
		expect(at("screens/b.tsx")).toMatchObject({ x: 0, y: 0 });
		expect(at("screens/b.alt-1.tsx")).toMatchObject({ x: 0, y: height + FRAME_GAP });
		expect(at("screens/a.tsx")).toMatchObject({ x: width + FRAME_GAP, y: 0 });
		expect(at("screens/a.alt-2.tsx")).toMatchObject({ x: width + FRAME_GAP, y: 2 * (height + FRAME_GAP) });
	});
});
