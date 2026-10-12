import { describe, expect, test } from "bun:test";
import {
	besideImage,
	pixelDifference,
	RECREATE_GAP,
	recreateDevice,
	referenceOf,
	sampleSize,
	screenOf,
} from "./recreate";
import type { CanvasImage, Frame } from "./types";

const frame = (file: string, x: number, extra: Partial<Frame> = {}): Frame => ({
	file,
	name: file,
	device: "mobile",
	x,
	y: 0,
	width: 390,
	height: 844,
	...extra,
});

const image = (id: string, x: number, width = 240, height = 520): CanvasImage => ({
	id,
	src: `/moodboard/${id}.png`,
	name: `${id}.png`,
	x,
	y: 0,
	width,
	height,
});

const pixels = (...colors: [number, number, number][]) =>
	new Uint8ClampedArray(colors.flatMap(([red, green, blue]) => [red, green, blue, 255]));

describe("recreate from screenshot", () => {
	test("the device follows the screenshot's shape and width", () => {
		expect(recreateDevice(1170, 2532)).toBe("mobile");
		expect(recreateDevice(390, 844)).toBe("mobile");
		expect(recreateDevice(1668, 2388)).toBe("tablet");
		expect(recreateDevice(2880, 1800)).toBe("desktop");
		expect(recreateDevice(2560, 8000)).toBe("desktop");
	});

	test("the screen goes right of the image, as tall as the screenshot at its width", () => {
		const placed = besideImage(frame("screens/a.tsx", 0), image("shot", 100, 195, 600), []);

		expect(placed).toMatchObject({ x: 100 + 195 + RECREATE_GAP, y: 0, width: 390, height: 1200, reference: "shot" });
	});

	test("the screen moves past what is already beside the image", () => {
		const taken = [frame("screens/old.tsx", 400)];
		const placed = besideImage(frame("screens/a.tsx", 0), image("shot", 0), taken);

		expect(placed.x).toBe(400 + 390 + RECREATE_GAP);
	});

	test("a screen compares with the image it came from, else the one beside it", () => {
		const frames = [frame("screens/a.tsx", 0, { reference: "far" }), frame("screens/b.tsx", 3000)];
		const images = [image("far", 9000), image("near", 2700)];

		expect(referenceOf(frames[0]!, images, frames)?.id).toBe("far");
		expect(referenceOf(frames[1]!, images, frames)?.id).toBe("near");
		expect(screenOf(images[0]!, frames)?.file).toBe("screens/a.tsx");
		expect(screenOf(images[1]!, frames)?.file).toBe("screens/b.tsx");
		expect(screenOf(image("alone", 20000), frames)).toBe(null);
	});

	test("the difference counts pixels past the tolerance", () => {
		const white = pixels([255, 255, 255], [255, 255, 255], [0, 0, 0], [10, 10, 10]);
		const close = pixels([250, 250, 250], [255, 255, 255], [0, 0, 0], [10, 10, 10]);
		const half = pixels([255, 255, 255], [0, 0, 255], [0, 0, 0], [200, 10, 10]);

		expect(pixelDifference(white, close)).toBe(0);
		expect(pixelDifference(white, half)).toBe(0.5);
		expect(pixelDifference(new Uint8ClampedArray(), new Uint8ClampedArray())).toBe(0);
	});

	test("samples keep the aspect at a small width", () => {
		expect(sampleSize(1280, 800)).toEqual({ width: 160, height: 100 });
		expect(sampleSize(100, 50)).toEqual({ width: 100, height: 50 });
	});
});
