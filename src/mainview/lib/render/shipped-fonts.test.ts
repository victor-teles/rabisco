import { describe, expect, test } from "bun:test";
import { ShippedFonts, usesShippedFont } from "./shipped-fonts";

describe("usesShippedFont", () => {
	test("finds Inter in a font stack", () => {
		expect(usesShippedFont(':root { --font-sans: "Inter", system-ui, sans-serif; }')).toBe(true);
		expect(usesShippedFont(".a { font-family: Inter, sans-serif }")).toBe(true);
	});

	test("ignores other families and Inter outside a font stack", () => {
		expect(usesShippedFont(':root { --font-sans: "Inter Tight", sans-serif; }')).toBe(false);
		expect(usesShippedFont(':root { --font-sans: system-ui; } .a::after { content: "Inter" }')).toBe(false);
	});
});

describe("ShippedFonts", () => {
	test("tells listeners when the fonts load, and gives data URLs for the share viewer", async () => {
		const fonts = new ShippedFonts();
		let calls = 0;
		const unsubscribe = fonts.subscribe(() => calls++);
		expect(await fonts.dataUrls()).toEqual([]);

		fonts.set([{ weight: 600, unicodeRange: "U+0000-00FF", file: new Blob(["woff"], { type: "font/woff" }) }]);
		expect(calls).toBe(1);
		expect(await fonts.dataUrls()).toEqual([
			{ weight: 600, unicodeRange: "U+0000-00FF", file: `data:font/woff;base64,${btoa("woff")}` },
		]);

		unsubscribe();
		fonts.set(null);
		expect(calls).toBe(1);
	});
});
