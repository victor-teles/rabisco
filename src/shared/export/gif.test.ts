import { describe, expect, test } from "bun:test";
import { GifWriter, quantize } from "./gif";

type DecodedFrame = { delay: number; pixels: Uint8Array };

function lzwDecode(data: Uint8Array, minCodeSize: number, count: number) {
	const clear = 1 << minCodeSize;
	const eoi = clear + 1;
	const out = new Uint8Array(count);
	let at = 0;
	let size = minCodeSize + 1;
	let dictionary: number[][] = [];
	let previous: number[] | null = null;
	let bit = 0;

	const reset = () => {
		dictionary = Array.from({ length: eoi + 1 }, (_, i) => [i]);
		size = minCodeSize + 1;
		previous = null;
	};

	reset();

	while (bit + size <= data.length * 8) {
		let code = 0;

		for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3]! >> (bit & 7)) & 1) << i;

		if (code === clear) {
			reset();

			continue;
		}

		if (code === eoi) break;
		const entry: number[] = dictionary[code] ?? [...previous!, previous![0]!];

		for (const index of entry) out[at++] = index;

		if (previous) dictionary.push([...previous, entry[0]!]);
		previous = entry;

		if (dictionary.length === 1 << size && size < 12) size++;
	}

	expect(at).toBe(count);

	return out;
}

function decode(gif: Uint8Array) {
	const text = (from: number, length: number) => String.fromCharCode(...gif.subarray(from, from + length));
	const short = (at: number) => gif[at]! | (gif[at + 1]! << 8);

	expect(text(0, 6)).toBe("GIF89a");
	const width = short(6);
	const height = short(8);
	const frames: DecodedFrame[] = [];
	let at = 13;
	let delay = 0;
	let loops = false;

	const blocks = () => {
		const parts: number[] = [];

		while (gif[at]) {
			const length = gif[at]!;
			parts.push(...gif.subarray(at + 1, at + 1 + length));
			at += length + 1;
		}

		at++;

		return Uint8Array.from(parts);
	};

	while (gif[at] !== 0x3b) {
		if (gif[at] === 0x21) {
			const label = gif[at + 1];
			at += 2;

			if (label === 0xff && text(at + 1, 11) === "NETSCAPE2.0") loops = true;

			if (label === 0xf9) delay = short(at + 2) * 10;
			blocks();
		} else if (gif[at] === 0x2c) {
			const packed = gif[at + 9]!;
			const colors = 2 << (packed & 7);
			const table = gif.subarray(at + 10, at + 10 + colors * 3);
			at += 10 + colors * 3;
			const minCodeSize = gif[at++]!;
			const indexes = lzwDecode(blocks(), minCodeSize, width * height);
			const pixels = new Uint8Array(width * height * 3);

			indexes.forEach((index, p) => pixels.set(table.subarray(index * 3, index * 3 + 3), p * 3));
			frames.push({ delay, pixels });
		} else throw new Error(`Unexpected block ${gif[at]}`);
	}

	return { width, height, loops, frames };
}

function image(width: number, height: number, color: (x: number, y: number) => [number, number, number]) {
	const pixels = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) pixels.set([...color(x, y), 255], (y * width + x) * 4);

	return pixels;
}

const rgbOf = (pixels: Uint8ClampedArray) => Uint8Array.from(pixels.filter((_, i) => i % 4 !== 3));

describe("quantize", () => {
	test("keeps colors exact when there are 256 or fewer", () => {
		const pixels = image(16, 16, (x, y) => [x * 16, y * 16, 7]);
		const { colors, indexes } = quantize(pixels);

		expect(colors.length).toBe(256 * 3);

		indexes.forEach((index, p) =>
			expect([...colors.subarray(index * 3, index * 3 + 3)]).toEqual([...pixels.subarray(p * 4, p * 4 + 3)]),
		);
	});

	test("reduces a gradient to 256 colors that stay close", () => {
		const pixels = image(128, 64, (x, y) => [x * 2, y * 4, (x + y) & 0xff]);
		const { colors, indexes } = quantize(pixels);

		expect(colors.length).toBeLessThanOrEqual(256 * 3);
		let worst = 0;

		indexes.forEach((index, p) => {
			for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(colors[index * 3 + c]! - pixels[p * 4 + c]!));
		});

		expect(worst).toBeLessThan(40);
	});
});

describe("GifWriter", () => {
	test("writes frames that decode back to the same pixels, with delays and a loop", () => {
		const first = image(40, 30, (x, y) => (x < 20 ? [255, 255, 255] : y < 15 ? [24, 24, 27] : [37, 99, 235]));
		const second = image(40, 30, (x, y) => [(x % 16) * 16, (y % 16) * 16, 128]);
		const writer = new GifWriter(40, 30);

		writer.add(first, 1500);
		writer.add(second, 40);
		const gif = decode(writer.finish());

		expect(gif).toMatchObject({ width: 40, height: 30, loops: true });
		expect(gif.frames.map((f) => f.delay)).toEqual([1500, 40]);
		expect(gif.frames[0]!.pixels).toEqual(rgbOf(first));
		expect(gif.frames[1]!.pixels).toEqual(rgbOf(second));
	});

	test("survives a large, noisy frame that fills the code table", () => {
		let seed = 7;

		const noise = image(300, 200, () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;

			return [seed & 0xf0, (seed >> 8) & 0xf0, (seed >> 16) & 0xf0];
		});

		const writer = new GifWriter(300, 200);
		writer.add(noise, 100);
		writer.add(noise, 100);
		const gif = decode(writer.finish());

		expect(gif.frames).toHaveLength(2);

		for (const frame of gif.frames) {
			let worst = 0;

			frame.pixels.forEach(
				(value, i) => (worst = Math.max(worst, Math.abs(value - noise[Math.floor(i / 3) * 4 + (i % 3)]!))),
			);
			expect(worst).toBeLessThan(96);
		}
	});

	test("refuses a frame of the wrong size", () => {
		expect(() => new GifWriter(4, 4).add(new Uint8ClampedArray(8), 100)).toThrow();
	});
});
