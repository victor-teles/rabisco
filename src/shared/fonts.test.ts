import { describe, expect, test } from "bun:test";
import { faceLabel, fontFace, fontFaceCss, fontFamilies, fontFileName, fontToken, leadingFamily } from "./fonts";

describe("fontFileName", () => {
	test("reads the family, weight and style from the uploaded name", () => {
		expect(fontFileName("BrandSans-BoldItalic.ttf")).toBe("brand-sans-700-italic.ttf");
		expect(fontFileName("Brand Sans Regular.WOFF2")).toBe("brand-sans.woff2");
		expect(fontFileName("Inter_SemiBold.otf")).toBe("inter-600.otf");
		expect(fontFileName("space grotesk extra light.woff")).toBe("space-grotesk-200.woff");
		expect(fontFileName("Mono-300.woff2")).toBe("mono-300.woff2");
		expect(fontFileName("Serif-Italic.woff2")).toBe("serif-italic.woff2");
	});

	test("rejects files that aren't fonts", () => {
		expect(fontFileName("logo.png")).toBeNull();
		expect(fontFileName("font")).toBeNull();
	});
});

describe("fontFace", () => {
	test("parses a face from its src", () => {
		expect(fontFace("/fonts/brand-sans-700-italic.woff2")).toEqual({
			src: "/fonts/brand-sans-700-italic.woff2",
			slug: "brand-sans",
			family: "Brand Sans",
			weight: 700,
			style: "italic",
		});
		expect(fontFace("/fonts/inter.ttf")?.weight).toBe(400);
		expect(fontFace("/images/inter.ttf")).toBeNull();
		expect(fontFace("/fonts/logo.png")).toBeNull();
	});
});

describe("fontFamilies and fontFaceCss", () => {
	const srcs = ["/fonts/inter-700.woff2", "/images/a.png", "/fonts/brand-sans.woff2", "/fonts/inter.woff2"];

	test("groups faces by family", () => {
		const families = fontFamilies(srcs);
		expect(families.map((family) => family.family)).toEqual(["Brand Sans", "Inter"]);
		expect(families[1]!.faces.map(faceLabel)).toEqual(["Regular", "Bold"]);
	});

	test("writes one @font-face per face", () => {
		const css = fontFaceCss(srcs, (src) => `.${src}`);
		expect(css.match(/@font-face/g)).toHaveLength(3);
		expect(css).toContain(
			'font-family: "Inter";\n\tsrc: url("./fonts/inter-700.woff2") format("woff2");\n\tfont-weight: 700;',
		);
		expect(fontFaceCss(["/images/a.png"])).toBe("");
	});

	test("gives a family a font token", () => {
		const [family] = fontFamilies(["/fonts/brand-sans.woff2"]);
		const token = fontToken(family!);
		expect(token).toEqual({ name: "font-brand-sans", value: '"Brand Sans", ui-sans-serif, sans-serif' });
		expect(leadingFamily(token.value)).toBe("brand sans");
	});
});
