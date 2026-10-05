import { describe, expect, test } from "bun:test";
import type { Frame } from "../types";
import { mixOklab, parseColor, toHex, type Rgba } from "./color";
import { flowDocument, flowOrder, fitText, type FlowScreen } from "./flow";
import { createPdf, jpegSize, pdfString, pdfTextString, PT_PER_PX } from "./pdf";
import {
	fitRadii,
	inset,
	parseBoxShadow,
	parseLinearGradient,
	rectPath,
	sceneToSvg,
	splitTopLevel,
	type Scene,
} from "./scene";
import { exportSlug, imageFileNames, imageTargets } from "./targets";

const near = (color: Rgba | null, expected: [number, number, number, number?], tolerance = 2) => {
	expect(color).not.toBeNull();
	const [r, g, b, a = 1] = expected;

	for (const [actual, wanted] of [
		[color!.r, r],
		[color!.g, g],
		[color!.b, b],
	] as const)
		expect(Math.abs(actual - wanted)).toBeLessThanOrEqual(tolerance);
	expect(color!.a).toBeCloseTo(a, 2);
};

describe("parseColor", () => {
	test("legacy and modern rgb, hex, named", () => {
		near(parseColor("rgb(255, 0, 0)"), [255, 0, 0]);
		near(parseColor("rgba(0, 0, 0, 0.1)"), [0, 0, 0, 0.1]);
		near(parseColor("rgb(10 20 30 / 50%)"), [10, 20, 30, 0.5]);
		near(parseColor("#0f08"), [0, 255, 0, 0.533]);
		near(parseColor("#3b82f6"), [59, 130, 246]);
		near(parseColor("transparent"), [0, 0, 0, 0]);
		near(parseColor("hsl(0, 100%, 50%)"), [255, 0, 0]);
	});

	test("oklch, oklab, lab, lch and color() convert to sRGB", () => {
		near(parseColor("oklch(1 0 0)"), [255, 255, 255]);
		near(parseColor("oklch(0 0 0)"), [0, 0, 0]);
		near(parseColor("oklch(0.628 0.2577 29.23)"), [255, 0, 0]);
		near(parseColor("oklch(62.8% 0.2577 29.23deg / 0.5)"), [255, 0, 0, 0.5]);
		near(parseColor("oklch(0.145 0 0)"), [10, 10, 10]);
		near(parseColor("oklab(0.205 0 0 / 0.5)"), [23, 23, 23, 0.5]);
		near(parseColor("lab(54.29 80.82 69.91)"), [255, 0, 0]);
		near(parseColor("lch(54.29 106.84 40.85)"), [255, 0, 0]);
		near(parseColor("color(srgb 1 0.5 0)"), [255, 128, 0]);
		near(parseColor("color(display-p3 1 1 1)"), [255, 255, 255]);
		// Out of gamut clips
		near(parseColor("color(display-p3 0 1 0)"), [0, 255, 0], 3);
	});

	test("anything else is null", () => {
		expect(parseColor("currentcolor")).toBeNull();
		expect(parseColor("color-mix(in oklab, red, blue)")).toBeNull();
		expect(parseColor("rgb(a, b, c)")).toBeNull();
	});

	test("toHex and mixOklab", () => {
		expect(toHex({ r: 255, g: 0, b: 16, a: 1 })).toBe("#ff0010");
		const white = { r: 255, g: 255, b: 255, a: 1 };
		const black = { r: 0, g: 0, b: 0, a: 1 };
		expect(mixOklab(white, black, 0)).toEqual(white);
		expect(mixOklab(white, black, 1)).toEqual(black);
		// OKLab's midpoint is lighter than sRGB's 128
		expect(mixOklab(white, black, 0.5).r).toBeGreaterThan(90);
	});
});

describe("scene geometry", () => {
	test("radii scale down together when they overlap", () => {
		expect(fitRadii(100, 40, [33554400, 33554400, 33554400, 33554400])).toEqual([20, 20, 20, 20]);
		expect(fitRadii(100, 100, [8, 8, 0, 0])).toEqual([8, 8, 0, 0]);
	});

	test("rectPath draws plain and rounded rectangles", () => {
		expect(rectPath({ x: 0, y: 0, width: 10, height: 5, radii: [0, 0, 0, 0] })).toBe("M0 0h10v5h-10Z");
		const rounded = rectPath({ x: 0, y: 0, width: 10, height: 10, radii: [2, 2, 2, 2] });
		expect(rounded.startsWith("M2 0h6a2 2 0 0 1 2 2")).toBe(true);
		expect(rounded.endsWith("Z")).toBe(true);
	});

	test("inset shrinks the box and its radii", () => {
		expect(inset({ x: 0, y: 0, width: 10, height: 10, radii: [4, 0, 0, 0] }, 1)).toEqual({
			x: 1,
			y: 1,
			width: 8,
			height: 8,
			radii: [3, 0, 0, 0],
		});
	});

	test("splitTopLevel ignores commas in functions", () => {
		expect(splitTopLevel("rgb(0, 0, 0) 0px 1px, oklch(1 0 0 / 0.5) 0 0 0 2px")).toEqual([
			"rgb(0, 0, 0) 0px 1px",
			"oklch(1 0 0 / 0.5) 0 0 0 2px",
		]);
	});
});

describe("parseBoxShadow", () => {
	test("reads Tailwind's layered shadows and drops the empty ones", () => {
		const shadows = parseBoxShadow(
			"rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklch(0.708 0 0) 0px 0px 0px 2px, rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px",
		);

		expect(shadows).toHaveLength(3);
		expect(shadows[0]).toMatchObject({ spread: 2, blur: 0, inset: false });
		expect(shadows[1]).toMatchObject({ offsetY: 1, blur: 3 });
		expect(shadows[2]).toMatchObject({ spread: -1 });
	});

	test("inset and color-last forms", () => {
		expect(parseBoxShadow("inset 0 2px 4px #0000001a")[0]).toMatchObject({ inset: true, offsetY: 2, blur: 4 });
		expect(parseBoxShadow("none")).toEqual([]);
	});
});

describe("parseLinearGradient", () => {
	const box = { x: 0, y: 0, width: 200, height: 100 };

	test("to right in oklab: stops resolved, oklab steps added", () => {
		const paint = parseLinearGradient(
			"linear-gradient(to right in oklab, oklch(0.623 0.214 259.815) 0%, oklch(0.585 0.233 277.117) 100%)",
			box,
		);

		expect(paint?.kind).toBe("linear");

		if (paint?.kind !== "linear") return;
		expect([paint.x1, paint.y1, paint.x2, paint.y2]).toEqual([0, 50, 200, 50]);
		expect(paint.stops.length).toBeGreaterThan(2);
		expect(paint.stops[0]!.offset).toBe(0);
		expect(paint.stops.at(-1)!.offset).toBe(1);
	});

	test("default direction, missing positions and angles", () => {
		const paint = parseLinearGradient("linear-gradient(rgb(255, 0, 0), rgb(0, 255, 0), rgb(0, 0, 255))", box);

		if (paint?.kind !== "linear") throw new Error("expected a gradient");
		expect([paint.x1, paint.y1, paint.x2, paint.y2]).toEqual([100, 0, 100, 100]);
		expect(paint.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
		const angled = parseLinearGradient("linear-gradient(90deg, red, blue)", box);

		if (angled?.kind !== "linear") throw new Error("expected a gradient");
		expect(Math.round(angled.x2)).toBe(200);
	});

	test("not a linear gradient", () => {
		expect(parseLinearGradient("radial-gradient(red, blue)", box)).toBeNull();
		expect(parseLinearGradient("url(x.png)", box)).toBeNull();
	});
});

describe("sceneToSvg", () => {
	const scene: Scene = {
		width: 390,
		height: 844,
		background: { r: 255, g: 255, b: 255, a: 1 },
		links: [],
		ops: [
			{
				type: "fill",
				rect: { x: 16, y: 16, width: 100, height: 40, radii: [8, 8, 8, 8] },
				paint: { kind: "color", color: { r: 23, g: 23, b: 23, a: 1 } },
			},
			{
				type: "shadow",
				rect: { x: 16, y: 16, width: 100, height: 40, radii: [8, 8, 8, 8] },
				color: { r: 0, g: 0, b: 0, a: 0.1 },
				offsetX: 0,
				offsetY: 1,
				blur: 3,
				spread: 0,
			},
			{
				type: "group",
				opacity: 0.5,
				clip: { x: 0, y: 0, width: 50, height: 50, radii: [0, 0, 0, 0] },
				ops: [
					{
						type: "text",
						x: 20,
						y: 40,
						width: 60,
						text: "Sign <in> & go",
						font: { family: 'ui-sans-serif, "Apple Color Emoji"', size: 14, weight: "500", style: "normal" },
						paint: { kind: "color", color: { r: 250, g: 250, b: 250, a: 1 } },
						letterSpacing: 0,
					},
				],
			},
			{
				type: "path",
				d: "M5 12h14",
				transform: [1, 0, 0, 1, 10, 10],
				stroke: { color: { r: 0, g: 0, b: 0, a: 1 }, width: 2, cap: "round", join: "round", miterLimit: 4, dash: [] },
			},
		],
	};

	test("writes a standalone SVG with real shapes and escaped text", () => {
		const svg = sceneToSvg(scene, "Welcome");
		expect(svg).toStartWith('<?xml version="1.0"');
		expect(svg).toContain('width="390" height="844" viewBox="0 0 390 844"');
		expect(svg).toContain("<title>Welcome</title>");
		expect(svg).toContain('<rect x="16" y="16" width="100" height="40" rx="8" fill="#171717"/>');
		expect(svg).toContain("Sign &lt;in&gt; &amp; go");
		expect(svg).toContain('font-family="ui-sans-serif, &quot;Apple Color Emoji&quot;"');
		expect(svg).toContain('opacity="0.5"');
		expect(svg).toContain("<feGaussianBlur");
		expect(svg).toContain('transform="matrix(1 0 0 1 10 10)"');
		expect(svg).not.toContain("foreignObject");

		// Every referenced id is defined
		for (const [, id] of svg.matchAll(/url\(#([a-z]\d+)\)/g)) expect(svg).toContain(`id="${id}"`);
	});
});

describe("pdf", () => {
	// The smallest JPEG header the size reader needs: SOI, APP0 (skipped), SOF0
	const fakeJpeg = (width: number, height: number) =>
		Uint8Array.from([
			0xff,
			0xd8,
			0xff,
			0xe0,
			0x00,
			0x04,
			0x00,
			0x00,
			0xff,
			0xc0,
			0x00,
			0x11,
			0x08,
			height >> 8,
			height & 255,
			width >> 8,
			width & 255,
			3,
			0,
			0,
			0,
			0xff,
			0xd9,
		]);

	const latin = (bytes: Uint8Array) => String.fromCharCode(...bytes);

	test("strings: escapes, WinAnsi and UTF-16 metadata", () => {
		expect(pdfString("a (b) \\ c")).toBe("(a \\(b\\) \\\\ c)");
		expect(pdfString("Café – ok…")).toBe(`(Caf\xe9 \x96 ok\x85)`);
		expect(pdfString("日本")).toBe("(??)");
		expect(pdfTextString("Hé")).toBe("<FEFF004800E9>");
	});

	test("jpegSize reads the frame header", () => {
		expect(jpegSize(fakeJpeg(780, 1688))).toEqual({ width: 780, height: 1688 });
		expect(jpegSize(Uint8Array.from([1, 2, 3]))).toBeNull();
	});

	test("a valid structure: header, objects, xref offsets, trailer", () => {
		const jpeg = fakeJpeg(2, 2);

		const bytes = createPdf({
			title: "Flow",
			images: [{ jpeg, width: 2, height: 2 }],
			pages: [
				{
					width: 300,
					height: 600,
					draw: [
						{ type: "image", image: 0, x: 10, y: 10, width: 100, height: 100 },
						{ type: "text", text: "Welcome", x: 10, y: 140, size: 12, bold: true },
					],
					links: [{ x: 0, y: 0, width: 50, height: 50, page: 1 }],
				},
				{ width: 900, height: 700, draw: [{ type: "rect", x: 0, y: 0, width: 10, height: 10, fill: [1, 0, 0] }] },
			],
			outline: [
				{ title: "One", page: 0 },
				{ title: "Two", page: 1 },
			],
		});

		const text = latin(bytes);
		expect(text).toStartWith("%PDF-1.4\n");
		expect(text.trimEnd()).toEndWith("%%EOF");
		expect(text.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(2);
		expect(text).toContain("/Count 2");
		expect(text).toContain("/MediaBox [0 0 300 600]");
		expect(text).toContain("/MediaBox [0 0 900 700]");
		expect(text).toContain("/Filter /DCTDecode");
		expect(text).toContain("/Subtype /Link");
		expect(text).toContain("/Outlines");
		// The image bytes are embedded as they are
		expect(text).toContain(latin(jpeg));
		// startxref points at the xref table, and every entry at its object
		const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
		expect(text.slice(startxref, startxref + 4)).toBe("xref");
		const xref = text.slice(startxref).split("\n");
		const count = Number(xref[1]!.split(" ")[1]);
		expect(text).toContain(`/Size ${count}`);

		for (let id = 1; id < count; id++) {
			const entry = xref[2 + id]!;
			expect(entry).toMatch(/^\d{10} 00000 n $/);
			const offset = Number(entry.slice(0, 10));
			expect(text.slice(offset, offset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`);
		}

		// Top-left coordinates are flipped: the text baseline at 140 sits at 600 - 140
		expect(text).toContain("10 460 Td");
	});

	test("needs a page", () => {
		expect(() => createPdf({ images: [], pages: [] })).toThrow();
	});
});

describe("flowOrder", () => {
	const screen = (links: string[]) =>
		`export default function S() { return <div>${links.map((to) => `<a data-link-to="${to}">x</a>`).join("")}</div>; }\n`;

	test("breadth-first from the first screen, then the rest in canvas order", () => {
		const files = {
			"screens/welcome.tsx": screen(["screens/signup.tsx", "login"]),
			"screens/login.tsx": screen(["screens/home.tsx", "back"]),
			"screens/signup.tsx": screen(["screens/home.tsx"]),
			"screens/home.tsx": screen(["screens/welcome.tsx", "screens/missing.tsx"]),
			"screens/settings.tsx": screen([]),
			"screens/about.tsx": screen(["screens/settings.tsx"]),
		};

		const canvas = [
			"screens/settings.tsx",
			"screens/welcome.tsx",
			"screens/home.tsx",
			"screens/login.tsx",
			"screens/signup.tsx",
			"screens/about.tsx",
		];

		expect(flowOrder(canvas, files)).toEqual([
			"screens/settings.tsx",
			"screens/welcome.tsx",
			"screens/signup.tsx",
			"screens/login.tsx",
			"screens/home.tsx",
			"screens/about.tsx",
		]);
		expect(
			flowOrder(
				["screens/welcome.tsx", "screens/settings.tsx", "screens/home.tsx", "screens/login.tsx", "screens/signup.tsx"],
				files,
			),
		).toEqual([
			"screens/welcome.tsx",
			"screens/signup.tsx",
			"screens/login.tsx",
			"screens/home.tsx",
			"screens/settings.tsx",
		]);
	});

	test("links to screens outside the export are ignored", () => {
		const files = {
			"screens/a.tsx": screen(["screens/b.tsx", "screens/c.tsx"]),
			"screens/b.tsx": screen([]),
			"screens/c.tsx": screen([]),
		};

		expect(flowOrder(["screens/c.tsx", "screens/a.tsx"], files)).toEqual(["screens/c.tsx", "screens/a.tsx"]);
	});
});

describe("flowDocument", () => {
	const image = { jpeg: new Uint8Array([0xff, 0xd8]), width: 780, height: 1688 };

	const screens: FlowScreen[] = [
		{
			file: "screens/welcome.tsx",
			name: "Welcome",
			width: 390,
			height: 844,
			image,
			links: [
				{ to: "screens/home.tsx", box: { x: 16, y: 700, width: 358, height: 48 } },
				{ to: "back", box: { x: 0, y: 0, width: 40, height: 40 } },
			],
		},
		{ file: "screens/home.tsx", name: "Home", width: 390, height: 1200, image, links: [] },
	];

	const files = { "screens/welcome.tsx": "", "screens/home.tsx": "" };

	test("an overview page, then one page per screen sized to it", () => {
		const doc = flowDocument({ title: "My app", screens, files });
		expect(doc.pages).toHaveLength(3);
		expect(doc.pages[1]!.width).toBe((390 + 80) * PT_PER_PX);
		expect(doc.pages[2]!.height).toBe((40 + 64 + 1200 + 40) * PT_PER_PX);
		// Overview thumbnails link to their pages
		expect(doc.pages[0]!.links!.map((l) => l.page)).toEqual([1, 2]);
		// Screen links go to the linked page; `back` has nowhere to go
		expect(doc.pages[1]!.links).toHaveLength(1);
		expect(doc.pages[1]!.links![0]!.page).toBe(2);
		expect(doc.outline!.map((o) => o.title)).toEqual(["Overview", "Welcome", "Home"]);
		expect(createPdf(doc).length).toBeGreaterThan(0);
	});

	test("a single screen has no overview", () => {
		const doc = flowDocument({ title: "x", screens: [screens[1]!], files });
		expect(doc.pages).toHaveLength(1);
	});

	test("fitText", () => {
		expect(fitText("Short", 200, 12)).toBe("Short");
		expect(fitText("A very long screen name indeed", 60, 12)).toEndWith("…");
	});
});

describe("targets", () => {
	const frame = (file: string): Frame => ({ file, name: file, device: "mobile", x: 0, y: 0, width: 390, height: 844 });
	const files = { "screens/a.tsx": "", "screens/a.alt-1.tsx": "", "screens/b.tsx": "" };

	const frames = [
		frame("screens/a.tsx"),
		frame("screens/a.alt-1.tsx"),
		frame("screens/b.tsx"),
		frame("screens/gone.tsx"),
	];

	test("all screens without alternates, or exactly the selection", () => {
		expect(imageTargets(frames, [], files).map((f) => f.file)).toEqual(["screens/a.tsx", "screens/b.tsx"]);
		expect(imageTargets(frames, [frames[1]!], files).map((f) => f.file)).toEqual(["screens/a.alt-1.tsx"]);
	});

	test("file names", () => {
		expect(imageFileNames(["screens/welcome.tsx", "screens/welcome.alt-1.tsx", "x/welcome.tsx"], "png")).toEqual([
			"welcome.png",
			"welcome.alt-1.png",
			"welcome-2.png",
		]);
		expect(exportSlug("My App")).toBe("my-app");
		expect(exportSlug("日本")).toBe("rabisco");
	});
});
