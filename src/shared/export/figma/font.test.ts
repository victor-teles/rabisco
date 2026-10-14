import { describe, expect, test } from "bun:test";
import { fontSet, glyphCommands, readFont, type FontFile } from "./font";

const FILES = new URL("../../../../node_modules/@fontsource/inter/files/", import.meta.url);

const bytesOf = async (name: string) => new Uint8Array(await Bun.file(new URL(name, FILES)).arrayBuffer());

async function interFiles(): Promise<FontFile[]> {
	const files: FontFile[] = [];

	for (const subset of ["latin", "latin-ext"])
		for (const weight of [400, 500, 600, 700])
			files.push({ weight, unicodeRange: "", bytes: await bytesOf(`inter-${subset}-${weight}-normal.woff`) });

	return files;
}

const contourSizes = (font: NonNullable<ReturnType<typeof readFont>>, char: string) =>
	font.contoursOf(font.glyphOf(char.codePointAt(0) ?? 0) ?? -1)?.map((contour) => contour.length);

describe("the TrueType reader", () => {
	test("reads Inter's metrics and glyphs, simple and composite", async () => {
		const font = readFont(await bytesOf("inter-latin-400-normal.woff"));

		expect(font).not.toBeNull();

		if (!font) return;
		expect([font.unitsPerEm, font.ascender, font.descender]).toEqual([2048, 1984, -494]);
		expect(contourSizes(font, "A")).toEqual([8, 11]);
		expect(contourSizes(font, "g")).toEqual([38, 16]);
		expect(contourSizes(font, "é")).toEqual([28, 10, 4]);
		expect(font.advanceOf(font.glyphOf(0x41) ?? 0)).toBe(1413);
		expect(font.advanceOf(font.glyphOf(0x67) ?? 0)).toBe(1256);
		expect(font.contoursOf(font.glyphOf(0x20) ?? 0)).toEqual([]);
	});

	test("writes outlines in Figma's glyph command format", async () => {
		const font = readFont(await bytesOf("inter-latin-400-normal.woff"));
		const contours = font?.contoursOf(font.glyphOf(0x43) ?? 0);

		expect(contours).toBeTruthy();

		if (!font || !contours) return;
		const blob = glyphCommands(contours, font.unitsPerEm);
		const view = new DataView(blob.buffer);

		expect(blob.length).toBe(505);
		expect([blob[0], blob[1], blob[blob.length - 1]]).toEqual([0, 1, 0]);
		expect(view.getFloat32(2, true)).toBeCloseTo(783 / 2048, 4);
	});

	test("fails to no font instead of throwing on bad bytes", async () => {
		const real = await bytesOf("inter-latin-400-normal.woff");

		expect(readFont(new Uint8Array(0))).toBeNull();
		expect(readFont(real.slice(0, 200))).toBeNull();
		expect(readFont(Uint8Array.from(real, (byte, i) => (i > 300 && i % 7 === 0 ? 255 - byte : byte)))).toBeNull();
	});
});

describe("the font set", () => {
	test("picks the nearest weight and the subset that has the character", async () => {
		const fonts = fontSet(await interFiles());

		expect(fonts?.ascent).toBeCloseTo(1984 / 2048);
		expect(fonts?.outline(0x41, 800)).toEqual(fonts?.outline(0x41, 700) ?? null);
		expect(fonts?.outline(0x41, 300)?.advance).toBe(fonts?.outline(0x41, 400)?.advance);
		expect(fonts?.outline(0x0142, 400)?.commands).toBeTruthy();
		expect(fonts?.outline(0x20, 400)).toEqual({ commands: null, advance: 576 / 2048 });
		expect(fonts?.outline(0x4e2d, 400)).toBeNull();
	});
});
