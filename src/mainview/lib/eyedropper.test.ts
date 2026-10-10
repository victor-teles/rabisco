import { describe, expect, test } from "bun:test";
import { snapColor, type ColorCandidate } from "./eyedropper";

const theme: ColorCandidate[] = [
	{ value: "background", css: "oklch(1 0 0)" },
	{ value: "primary", css: "oklch(0.205 0 0)" },
	{ value: "brand", css: "#e11d48" },
	{ value: "ring", css: "var(--ring)" },
];

const palette: ColorCandidate[] = [
	{ value: "white", css: "#fff" },
	{ value: "rose-600", css: "oklch(58.6% 0.253 17.585)" },
	{ value: "sky-500", css: "oklch(68.5% 0.169 237.323)" },
];

describe("snapColor", () => {
	test("snaps to a theme token before the palette", () => {
		expect(snapColor("rgb(255, 255, 255)", [theme, palette])).toBe("background");
		expect(snapColor("oklch(0.205 0 0)", [theme, palette])).toBe("primary");
		expect(snapColor("rgb(225, 29, 72)", [theme, palette])).toBe("brand");
	});

	test("snaps to the palette when no token matches", () => {
		expect(snapColor("oklch(0.685 0.169 237.323)", [theme, palette])).toBe("sky-500");
	});

	test("tolerates rounding", () => {
		expect(snapColor("rgb(254, 255, 254)", [theme, palette])).toBe("background");
	});

	test("writes an arbitrary hex when nothing matches", () => {
		expect(snapColor("rgb(18, 52, 86)", [theme, palette])).toBe("[#123456]");
	});

	test("keeps the alpha as an opacity modifier", () => {
		expect(snapColor("rgba(225, 29, 72, 0.5)", [theme, palette])).toBe("brand/50");
		expect(snapColor("rgba(18, 52, 86, 0.1)", [theme, palette])).toBe("[#123456]/10");
		expect(snapColor("rgba(0, 0, 0, 0)", [theme])).toBe("transparent");
	});

	test("ignores a color it can't read", () => {
		expect(snapColor("currentcolor", [theme])).toBeNull();
	});
});
