import { describe, expect, test } from "bun:test";
import { fitImage, gapBetween, MAX_REFERENCES, moodboardReferences, normalizeImages } from "./moodboard";
import type { CanvasImage, Frame } from "./types";

const frame = (file: string, x: number, y = 0): Frame => ({
	file,
	name: file,
	device: "mobile",
	x,
	y,
	width: 390,
	height: 844,
});

const image = (id: string, x: number, y = 0): CanvasImage => ({
	id,
	src: `/moodboard/${id}.png`,
	name: `${id}.png`,
	x,
	y,
	width: 200,
	height: 200,
});

describe("moodboard", () => {
	test("gap is zero for overlapping rects and the edge distance otherwise", () => {
		expect(gapBetween(image("a", 0), image("b", 100))).toBe(0);
		expect(gapBetween(image("a", 0), image("b", 300))).toBe(100);
		expect(gapBetween(image("a", 0, 0), image("b", 300, 400))).toBe(Math.hypot(100, 200));
	});

	test("an image goes with the screen it is nearest to", () => {
		const frames = [frame("screens/a.tsx", 0), frame("screens/b.tsx", 500)];
		const images = [image("besideA", -250), image("besideB", 950)];

		expect(moodboardReferences(images, frames, ["screens/a.tsx"]).map((i) => i.id)).toEqual(["besideA"]);
		expect(moodboardReferences(images, frames, ["screens/b.tsx"]).map((i) => i.id)).toEqual(["besideB"]);
	});

	test("a prompt on screens sends only the images near them, in reading order", () => {
		const frames = [frame("screens/a.tsx", 0), frame("screens/b.tsx", 5000)];
		const images = [image("far", 2500), image("right", 500), image("above", 0, -400), image("byB", 5500)];

		expect(moodboardReferences(images, frames, ["screens/a.tsx"]).map((i) => i.id)).toEqual(["above", "right"]);
		expect(moodboardReferences(images, frames, ["screens/a.tsx", "screens/b.tsx"]).map((i) => i.id)).toEqual([
			"above",
			"right",
			"byB",
		]);
	});

	test("a prompt without targets sends every image, capped", () => {
		const images = Array.from({ length: MAX_REFERENCES + 2 }, (_, i) => image(`i${i}`, (MAX_REFERENCES - i) * 300));
		const sent = moodboardReferences(images, [], []);

		expect(sent).toHaveLength(MAX_REFERENCES);
		expect(sent[0]!.x).toBeLessThan(sent[1]!.x);
	});

	test("the nearest images win when more are near than the cap", () => {
		const images = Array.from({ length: MAX_REFERENCES + 1 }, (_, i) => image(`i${i}`, 400 + i * 50));
		const sent = moodboardReferences(images, [frame("screens/a.tsx", 0)], ["screens/a.tsx"]);

		expect(sent.map((i) => i.id)).not.toContain(`i${MAX_REFERENCES}`);
	});

	test("parsing drops bad entries and images outside the moodboard folder", () => {
		expect(
			normalizeImages([
				image("ok", 0),
				image("ok", 10),
				{ ...image("outside", 0), src: "/images/logo.png" },
				{ ...image("escape", 0), src: "/moodboard/../secret.png" },
				{ ...image("flat", 0), height: 0 },
				"nope",
			]).map((i) => i.id),
		).toEqual(["ok"]);
	});

	test("large images are scaled down to a canvas width", () => {
		expect(fitImage(1920, 1080)).toEqual({ width: 480, height: 270 });
		expect(fitImage(100, 50)).toEqual({ width: 100, height: 50 });
	});
});
