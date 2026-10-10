import { describe, expect, test } from "bun:test";
import type { Rgba } from "../export/color";
import { composite, contrastRatio, layoutFindings, type LayoutBox, type LayoutNode } from "./layout-checks";

const FRAME = { width: 390, height: 844 };

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

const box = (x: number, y: number, width: number, height: number): LayoutBox => ({ x, y, width, height });

function node(fields: Partial<LayoutNode> = {}): LayoutNode {
	const area = fields.box ?? box(0, 0, 100, 20);

	return {
		loc: null,
		tag: "div",
		box: area,
		scrollWidth: area.width,
		scrollHeight: area.height,
		clientWidth: area.width,
		clientHeight: area.height,
		overflowX: "visible",
		overflowY: "visible",
		scrollsX: false,
		textOverflow: "clip",
		lineClamp: null,
		position: "static",
		display: "block",
		hasNegativeMargin: false,
		hasTransform: false,
		color: BLACK,
		background: null,
		hasBackgroundImage: false,
		opacity: 1,
		fontSize: 16,
		fontWeight: 400,
		ownText: "",
		hasBorder: false,
		children: [],
		...fields,
	};
}

const page = (...children: LayoutNode[]) => node({ loc: "screens/a.tsx:0", box: box(0, 0, 390, 844), children });

const rulesOf = (root: LayoutNode, rule: string) =>
	layoutFindings(root, FRAME).filter((found) => found.finding.rule === rule);

describe("contrast math", () => {
	test("matches the WCAG reference values", () => {
		expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
		expect(contrastRatio(WHITE, WHITE)).toBe(1);
		// #777 on white is the classic just-under-AA gray
		expect(contrastRatio({ r: 119, g: 119, b: 119, a: 1 }, WHITE)).toBeCloseTo(4.48, 2);
		expect(contrastRatio(WHITE, BLACK)).toBe(contrastRatio(BLACK, WHITE));
	});

	test("composites a translucent color over an opaque one", () => {
		expect(composite({ ...BLACK, a: 0.5 }, WHITE)).toEqual({ r: 128, g: 128, b: 128, a: 1 });
		expect(composite(WHITE, BLACK)).toEqual(WHITE);
	});
});

describe("layoutFindings: frame-overflow", () => {
	test("reports the element that sticks out, not its children or ancestors", () => {
		const wide = node({
			loc: "screens/a.tsx:40",
			box: box(0, 0, 500, 40),
			children: [node({ loc: "screens/a.tsx:60", box: box(0, 0, 500, 20) })],
		});

		const found = rulesOf(
			page(node({ loc: "screens/a.tsx:20", box: box(0, 0, 390, 40), children: [wide] })),
			"frame-overflow",
		);

		expect(found.map((item) => item.loc)).toEqual(["screens/a.tsx:40"]);
		expect(found[0]!.finding).toMatchObject({ severity: "error" });
		expect(found[0]!.finding.message).toContain("110px past the 390px frame");
	});

	test("skips content inside a sideways scroller or a clipping parent", () => {
		const item = () => node({ loc: "screens/a.tsx:80", box: box(300, 0, 200, 40) });
		const carousel = node({ box: box(0, 0, 390, 40), overflowX: "auto", scrollsX: true, children: [item()] });
		const clipped = node({ box: box(0, 40, 390, 40), overflowX: "hidden", children: [item()] });

		expect(rulesOf(page(carousel, clipped), "frame-overflow")).toEqual([]);
	});

	test("checks inside a scroller that only scrolls vertically", () => {
		const main = node({
			box: box(0, 0, 390, 800),
			overflowX: "auto",
			overflowY: "auto",
			children: [node({ loc: "screens/a.tsx:90", box: box(0, 0, 420, 40) })],
		});

		expect(rulesOf(page(main), "frame-overflow").map((item) => item.loc)).toEqual(["screens/a.tsx:90"]);
	});

	test("reports a repeated element once and caps the list", () => {
		const items = Array.from({ length: 20 }, (_, i) =>
			node({ loc: `screens/a.tsx:${i % 8}`, box: box(380, i * 10, 40, 10) }),
		);

		expect(rulesOf(page(...items), "frame-overflow")).toHaveLength(5);
	});
});

describe("layoutFindings: text-clipped", () => {
	const clipped = (fields: Partial<LayoutNode>) =>
		node({ ownText: "A long product name", overflowX: "hidden", scrollWidth: 180, clientWidth: 100, ...fields });

	test("reports text cut off by overflow hidden", () => {
		expect(rulesOf(page(clipped({ loc: "screens/a.tsx:10" })), "text-clipped")).toHaveLength(1);
		expect(
			rulesOf(
				page(clipped({ overflowY: "clip", scrollHeight: 60, clientHeight: 20, overflowX: "visible" })),
				"text-clipped",
			),
		).toHaveLength(1);
	});

	test("accepts an ellipsis, a line clamp, or a scroller", () => {
		const root = page(
			clipped({ textOverflow: "ellipsis" }),
			clipped({ lineClamp: 2 }),
			clipped({ overflowX: "auto" }),
			clipped({ scrollWidth: 100.5 }),
		);

		expect(rulesOf(root, "text-clipped")).toEqual([]);
	});
});

describe("layoutFindings: overlap", () => {
	test("reports in-flow siblings that overlap", () => {
		const root = page(
			node({ loc: "screens/a.tsx:10", box: box(0, 0, 200, 40) }),
			node({ loc: "screens/a.tsx:20", box: box(0, 20, 200, 40) }),
		);

		const found = rulesOf(root, "overlap");

		expect(found.map((item) => item.loc)).toEqual(["screens/a.tsx:20"]);
		expect(found[0]!.finding.severity).toBe("warning");
	});

	test("ignores positioned, transformed and negative-margin siblings, and touching edges", () => {
		const first = () => node({ box: box(0, 0, 200, 40) });

		expect(rulesOf(page(first(), node({ position: "absolute", box: box(0, 0, 200, 40) })), "overlap")).toEqual([]);
		expect(rulesOf(page(first(), node({ hasNegativeMargin: true, box: box(0, 0, 200, 40) })), "overlap")).toEqual([]);
		expect(rulesOf(page(first(), node({ hasTransform: true, box: box(0, 0, 200, 40) })), "overlap")).toEqual([]);
		expect(rulesOf(page(first(), node({ box: box(0, 38, 200, 40) })), "overlap")).toEqual([]);
	});

	test("compares the children of a display: contents wrapper with their grandparent's", () => {
		const wrapper = node({
			display: "contents",
			box: box(0, 0, 0, 0),
			children: [node({ loc: "screens/a.tsx:30", box: box(0, 10, 200, 40) })],
		});

		expect(rulesOf(page(node({ box: box(0, 0, 200, 40) }), wrapper), "overlap").map((item) => item.loc)).toEqual([
			"screens/a.tsx:30",
		]);
	});
});

describe("layoutFindings: contrast", () => {
	const text = (fields: Partial<LayoutNode>) => node({ loc: "screens/a.tsx:50", ownText: "Total", ...fields });

	test("errors under 3:1 and warns under 4.5:1 for body text", () => {
		const faint = text({ color: { r: 200, g: 200, b: 200, a: 1 } });
		const gray = text({ color: { r: 130, g: 130, b: 130, a: 1 } });

		expect(rulesOf(page(faint), "contrast")[0]!.finding.severity).toBe("error");
		expect(rulesOf(page(gray), "contrast")[0]!.finding.severity).toBe("warning");
		expect(rulesOf(page(text({})), "contrast")).toEqual([]);
	});

	test("large text only needs 3:1", () => {
		const gray = { r: 130, g: 130, b: 130, a: 1 };

		expect(rulesOf(page(text({ color: gray, fontSize: 24 })), "contrast")).toEqual([]);
		expect(rulesOf(page(text({ color: gray, fontSize: 19, fontWeight: 700 })), "contrast")).toEqual([]);
		expect(rulesOf(page(text({ color: gray, fontSize: 19, fontWeight: 600 })), "contrast")).toHaveLength(1);
	});

	test("composites translucent backgrounds over the first opaque one", () => {
		const overlay = node({ background: { ...WHITE, a: 0.1 }, children: [text({ color: WHITE })] });
		const dark = node({ background: { r: 20, g: 20, b: 20, a: 1 }, children: [overlay] });

		expect(rulesOf(page(dark), "contrast")).toEqual([]);
		// Over the white page instead, white text on a faint white wash is unreadable
		expect(rulesOf(page(overlay), "contrast")[0]!.finding.severity).toBe("error");
	});

	test("fades text by the opacity between it and its backdrop", () => {
		const faded = node({ opacity: 0.3, children: [text({})] });

		expect(rulesOf(page(faded), "contrast")[0]!.finding.severity).toBe("error");
	});

	test("skips text over a gradient or image", () => {
		const hero = node({ hasBackgroundImage: true, children: [text({ color: WHITE })] });

		expect(rulesOf(page(hero), "contrast")).toEqual([]);
	});
});

describe("layoutFindings: empty-container", () => {
	test("reports a tall empty flex or grid box", () => {
		const empty = node({ loc: "screens/a.tsx:70", display: "grid", box: box(0, 0, 390, 120) });

		expect(rulesOf(page(empty), "empty-container").map((item) => item.loc)).toEqual(["screens/a.tsx:70"]);
	});

	test("accepts painted, short, block or filled boxes", () => {
		const root = page(
			node({ display: "flex", box: box(0, 0, 390, 120), background: { r: 240, g: 240, b: 240, a: 1 } }),
			node({ display: "flex", box: box(0, 0, 390, 120), hasBorder: true }),
			node({ display: "flex", box: box(0, 0, 390, 120), hasBackgroundImage: true }),
			node({ display: "flex", box: box(0, 0, 390, 16) }),
			node({ display: "block", box: box(0, 0, 390, 120) }),
			node({ display: "flex", box: box(0, 0, 390, 120), ownText: "Nothing yet" }),
		);

		expect(rulesOf(root, "empty-container")).toEqual([]);
	});
});

describe("layoutFindings: font-sizes", () => {
	const label = (fontSize: number) => node({ ownText: "Label", fontSize });

	test("warns past 6 sizes on a screen, once", () => {
		const found = rulesOf(page(...[12, 13, 14, 16, 18, 20, 24].map(label)), "font-sizes");

		expect(found).toHaveLength(1);
		expect(found[0]!.finding.message).toContain("7 font sizes");
		expect(rulesOf(page(...[12, 14, 16, 18, 20, 24, 12.2].map(label)), "font-sizes")).toEqual([]);
	});

	test("warns past 3 sizes in a card, not counting a nested card", () => {
		const card = (children: LayoutNode[]) =>
			node({ loc: "screens/a.tsx:90", hasBorder: true, box: box(16, 0, 358, 200), children });

		expect(rulesOf(page(card([12, 14, 16, 20].map(label))), "font-sizes").map((item) => item.loc)).toEqual([
			"screens/a.tsx:90",
		]);

		const badge = node({ background: { r: 0, g: 0, b: 0, a: 1 }, box: box(20, 0, 40, 20), children: [label(10)] });
		expect(rulesOf(page(card([...[12, 14, 16].map(label), badge])), "font-sizes")).toEqual([]);
	});

	test("a full-width page background is not a card", () => {
		const shell = node({ background: WHITE, box: box(0, 0, 390, 844), children: [12, 14, 16, 20].map(label) });

		expect(rulesOf(page(shell), "font-sizes")).toEqual([]);
	});
});
