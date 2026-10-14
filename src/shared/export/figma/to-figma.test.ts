import { describe, expect, test } from "bun:test";
import {
	TEXT_TAG,
	type CapturedBox,
	type CapturedNode,
	type CapturedTree,
	type CssValues,
} from "../../import/captured-tree";
import { readFigmaClipboard } from "../../import/figma/clipboard";
import { isKiwiList, isKiwiRecord, type KiwiRecord } from "../../import/figma/kiwi";
import { figmaToCaptured } from "../../import/figma/to-captured";
import { figmaClipboard } from "./clipboard";
import { fontSet, type FontFile, type FontSet } from "./font";
import type { NodeFields } from "./node-change";
import { screensToFigma, type FigmaImage, type FigmaScreen } from "./to-figma";

const box = (x: number, y: number, width: number, height: number): CapturedBox => ({ x, y, width, height });

const el = (
	tag: string,
	at: CapturedBox,
	styles: CssValues,
	children: CapturedNode[] = [],
	extra: Partial<CapturedNode> = {},
): CapturedNode => ({
	tag,
	box: at,
	styles,
	children,
	...extra,
});

const text = (value: string, at: CapturedBox): CapturedNode => ({
	tag: TEXT_TAG,
	text: value,
	box: at,
	styles: {},
	children: [],
});

const body = (children: CapturedNode[], height = 800): CapturedNode =>
	el(
		"body",
		box(0, 0, 400, height),
		{ display: "block", "font-family": "Inter, sans-serif", "line-height": "20px", "font-size": "14px" },
		children,
	);

const screen = (root: CapturedNode, images: ReadonlyMap<string, FigmaImage> = new Map()): FigmaScreen => {
	const tree: CapturedTree = { title: "Home", width: 400, root };

	return { name: "Home", x: 100, y: 50, tree, images };
};

function changes(root: CapturedNode, images?: ReadonlyMap<string, FigmaImage>) {
	const copy = screensToFigma([screen(root, images)]);
	const byName = (name: string) => copy.nodeChanges.find((change) => change.name === name);

	return { copy, byName };
}

function roundTrip(root: CapturedNode) {
	const { html } = figmaClipboard([screen(root)]);
	const decoded = readFigmaClipboard(html);

	return { decoded, imported: figmaToCaptured(decoded.message) };
}

const row = (children: CapturedNode[], styles: CssValues = {}) =>
	el(
		"div",
		box(0, 0, 400, 40),
		{
			display: "flex",
			"column-gap": "8px",
			"padding-left": "16px",
			"padding-right": "16px",
			"align-items": "center",
			...styles,
		},
		children,
	);

const chip = (name: string, x: number, y = 10, width = 60, height = 20) =>
	el("div", box(x, y, width, height), { display: "block", "background-color": "rgb(255, 0, 0)" }, [], { name });

describe("auto layout", () => {
	test("a flex row becomes horizontal auto layout with its gap, padding and alignment", () => {
		const { byName, copy } = changes(body([row([chip("A", 16), chip("B", 84), chip("C", 152)])]));
		const frame = byName("Row");

		expect(frame).toMatchObject({
			type: "FRAME",
			stackMode: "HORIZONTAL",
			stackSpacing: 8,
			stackHorizontalPadding: 16,
			stackPaddingRight: 16,
			stackCounterAlignItems: "CENTER",
			stackPrimaryAlignItems: "MIN",
			stackPrimarySizing: "FIXED",
		});

		expect(copy.fixed).toBe(0);
	});

	test("a row that only holds its content hugs it", () => {
		const hugging = el(
			"div",
			box(0, 0, 160, 40),
			{
				display: "flex",
				"column-gap": "8px",
				"padding-left": "16px",
				"padding-right": "16px",
				"align-items": "center",
			},
			[chip("A", 16), chip("B", 84)],
		);

		const { byName } = changes(body([hugging]));

		expect(byName("Row")).toMatchObject({ stackPrimarySizing: "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE" });
	});

	test("justify-content space-between and flex-grow", () => {
		const between = row([chip("A", 16), chip("B", 324)], { "justify-content": "space-between" });

		const grown = row([
			chip("A", 16),
			el("div", box(84, 10, 300, 20), { display: "block", "flex-grow": "1" }, [], { name: "Grow" }),
		]);

		const first = changes(body([between]));
		const second = changes(body([grown]));

		expect(first.byName("Row")).toMatchObject({ stackPrimaryAlignItems: "SPACE_BETWEEN" });
		expect(second.byName("Grow")).toMatchObject({ stackChildPrimaryGrow: 1 });
	});

	test("space-around keeps the outer space as padding", () => {
		const around = row([chip("A", 76), chip("B", 264)], {
			"justify-content": "space-around",
			"padding-left": "0px",
			"padding-right": "0px",
		});

		const { byName, copy } = changes(body([around]));

		expect(byName("Row")).toMatchObject({
			stackPrimaryAlignItems: "SPACE_BETWEEN",
			stackHorizontalPadding: 76,
			stackPaddingRight: 76,
		});
		expect(copy.fixed).toBe(0);
	});

	test("stretched children of a column fill its width", () => {
		const column = el("div", box(0, 0, 400, 100), { display: "flex", "flex-direction": "column", "row-gap": "10px" }, [
			chip("A", 0, 0, 400, 20),
			chip("B", 0, 30, 400, 20),
		]);

		const { byName } = changes(body([column]));

		expect(byName("Column")).toMatchObject({ stackMode: "VERTICAL", stackSpacing: 10, stackCounterAlignItems: "MIN" });
		expect(byName("A")).toMatchObject({ stackChildAlignSelf: "STRETCH" });
	});

	test("reversed rows reverse the layer order", () => {
		const reversed = row([chip("A", 324), chip("B", 256)], {
			"flex-direction": "row-reverse",
			"justify-content": "flex-end",
		});

		const { copy } = changes(body([reversed]));
		const names = copy.nodeChanges.map((change) => change.name);

		expect(names.indexOf("B")).toBeLessThan(names.indexOf("A"));
	});

	test("block flow with even spacing becomes vertical auto layout", () => {
		const block = el(
			"section",
			box(0, 0, 400, 100),
			{ display: "block", "padding-top": "10px", "padding-left": "20px", "padding-right": "20px" },
			[chip("A", 20, 10, 360, 20), chip("B", 20, 46, 360, 20), chip("C", 20, 82, 360, 18)],
		);

		const { byName, copy } = changes(body([block]));

		expect(byName("section")).toMatchObject({
			stackMode: "VERTICAL",
			stackSpacing: 16,
			stackVerticalPadding: 10,
			stackPrimarySizing: "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE",
		});
		expect(byName("A")).toMatchObject({ stackChildAlignSelf: "STRETCH" });
		expect(copy.fixed).toBe(0);
	});

	test("uneven block margins keep fixed positions and are counted", () => {
		const block = el("div", box(0, 0, 400, 100), { display: "block" }, [
			chip("A", 0, 0, 400, 20),
			chip("B", 0, 30, 400, 20),
			chip("C", 0, 80, 400, 20),
		]);

		const { byName, copy } = changes(body([block]));

		expect(byName("Box")?.stackMode).toBeUndefined();
		expect(byName("C")?.transform).toMatchObject({ m02: 0, m12: 80 });
		expect(copy.fixed).toBe(1);
	});

	test("a grid with equal tracks wraps like grid-cols-N", () => {
		const cards = [0, 1, 2, 3].map((i) => chip(`Card ${i}`, (i % 3) * 136, Math.floor(i / 3) * 116, 128, 100));

		const grid = el(
			"div",
			box(0, 0, 400, 216),
			{ display: "grid", "grid-template-columns": "128px 128px 128px", "column-gap": "8px", "row-gap": "16px" },
			cards,
		);

		const { byName, copy } = changes(body([grid]));

		expect(byName("Grid")).toMatchObject({
			stackMode: "HORIZONTAL",
			stackWrap: "WRAP",
			stackSpacing: 8,
			stackCounterSpacing: 16,
		});
		expect(copy.fixed).toBe(0);
	});

	test("an absolute child of a flex row keeps its place and constraints", () => {
		const badge = el(
			"span",
			box(380, 0, 20, 20),
			{ display: "block", position: "absolute", top: "0px", right: "0px", "background-color": "red" },
			[],
			{ name: "Badge" },
		);

		const { byName } = changes(body([row([chip("A", 16), badge], { position: "relative" })]));

		expect(byName("Badge")).toMatchObject({
			stackPositioning: "ABSOLUTE",
			horizontalConstraint: "MAX",
			verticalConstraint: "MIN",
		});
	});

	test("grid cells keep their track width and one full row doesn't wrap", () => {
		const field = (i: number) =>
			el("div", box(i * 136, 0, 128, 60), { display: "flex", "flex-direction": "column", "row-gap": "4px" }, [
				el("label", box(i * 136, 0, 40, 20), { display: "block" }, [text(`F${i}`, box(i * 136, 0, 40, 20))]),
				el("div", box(i * 136, 24, 128, 36), { display: "block", "background-color": "red" }, [], {
					name: `Input ${i}`,
				}),
			]);

		const grid = el(
			"div",
			box(0, 0, 400, 60),
			{ display: "grid", "grid-template-columns": "128px 128px 128px", "column-gap": "8px" },
			[0, 1, 2].map(field),
		);

		const { copy } = changes(body([grid]));
		const gridChange = copy.nodeChanges.find((change) => change.name === "Grid");
		const cells = copy.nodeChanges.filter((change) => change.stackMode === "VERTICAL" && change.size?.x === 128);

		expect(gridChange?.stackWrap).toBe("NO_WRAP");
		expect(cells).toHaveLength(3);
		expect(cells.every((cell) => cell.stackCounterSizing === "FIXED")).toBe(true);
	});

	test("right-aligned text keeps the width of its box", () => {
		const paragraph = el(
			"p",
			box(0, 0, 384, 20),
			{ display: "block", "text-align": "right", "background-color": "red" },
			[text("Right-aligned text", box(255, 0, 129, 20))],
		);

		const { copy } = changes(body([paragraph]));
		const frame = copy.nodeChanges.find((change) => change.type === "FRAME" && change.size?.x === 384);

		expect(frame?.stackCounterSizing).toBe("FIXED");
	});

	test("the screen frame keeps its size", () => {
		const sidebar = el("aside", box(0, 0, 100, 800), { display: "block", "background-color": "red" }, [], {
			name: "Sidebar",
		});

		const main = el("main", box(100, 0, 300, 200), { display: "block", "background-color": "blue" }, [], {
			name: "Main",
		});

		const page = el("div", box(0, 0, 400, 800), { display: "flex", "align-items": "flex-start" }, [sidebar, main]);
		const { copy } = changes(body([page]));
		const root = copy.nodeChanges.find((change) => change.name === "Home");

		expect(root).toMatchObject({ stackPrimarySizing: "FIXED", stackCounterSizing: "FIXED" });
	});
});

describe("layers", () => {
	test("a paragraph with a bold run is one text layer with an override", () => {
		const strong = el("strong", box(40, 0, 30, 20), { display: "inline", "font-weight": "700" }, [
			text("bold", box(40, 0, 30, 20)),
		]);

		const paragraph = el("p", box(0, 0, 400, 20), { display: "block" }, [
			text("Some ", box(0, 0, 40, 20)),
			strong,
			text(" text", box(70, 0, 30, 20)),
		]);

		const { byName } = changes(body([paragraph]));
		const layer = byName("Some bold text");
		const data = layer?.textData;

		expect(layer).toMatchObject({
			type: "TEXT",
			fontName: { family: "Inter", style: "Regular" },
			fontSize: 14,
			lineHeight: { value: 20, units: "PIXELS" },
			textAutoResize: "HEIGHT",
		});

		expect(data).toMatchObject({
			characters: "Some bold text",
			characterStyleIDs: [0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0],
		});
		expect(data).toMatchObject({ styleOverrideTable: [{ styleID: 1, fontName: { family: "Inter", style: "Bold" } }] });
	});

	test("a system font stack becomes Inter and every layer has an opacity", () => {
		const paragraph = el(
			"p",
			box(0, 0, 400, 20),
			{ display: "block", "font-family": 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
			[text("Hello", box(0, 0, 40, 20))],
		);

		const { copy, byName } = changes(body([paragraph]));

		expect(byName("Hello")).toMatchObject({ fontName: { family: "Inter" } });
		expect(
			copy.nodeChanges.flatMap((change) => (change.guid?.sessionID && change.opacity !== 1 ? [change] : [])),
		).toEqual([]);
	});

	test("a button is a frame named after its label with a hugging text layer", () => {
		const button = el(
			"button",
			box(0, 0, 90, 36),
			{
				display: "inline-flex",
				"align-items": "center",
				"justify-content": "center",
				"padding-left": "16px",
				"padding-right": "16px",
				"background-color": "rgb(0, 0, 0)",
				color: "rgb(255, 255, 255)",
				"border-top-left-radius": "6px",
				"border-top-right-radius": "6px",
				"border-bottom-left-radius": "6px",
				"border-bottom-right-radius": "6px",
			},
			[text("Sign up", box(16, 8, 58, 20))],
		);

		const { byName } = changes(body([button]));

		expect(byName('button "Sign up"')).toMatchObject({
			type: "FRAME",
			cornerRadius: 6,
			stackMode: "HORIZONTAL",
			stackPrimaryAlignItems: "CENTER",
		});
		expect(byName("Sign up")).toMatchObject({
			type: "TEXT",
			textAutoResize: "WIDTH_AND_HEIGHT",
			fillPaints: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
		});
	});

	test("images ride in the blobs and the paint points at them", () => {
		const bytes = new Uint8Array([137, 80, 78, 71]);
		const hash = new Uint8Array(20).fill(7);
		const images = new Map([["#image-0", { hash, bytes, width: 640, height: 480 }]]);

		const image = el("img", box(0, 0, 400, 300), { display: "block", "object-fit": "cover" }, [], {
			attrs: { src: "#image-0", alt: "Hero" },
		});

		const { byName, copy } = changes(body([image]), images);
		const layer = byName('image "Hero"');

		expect(layer).toMatchObject({ type: "RECTANGLE" });
		expect(layer?.fillPaints).toMatchObject([
			{ type: "IMAGE", imageScaleMode: "FILL", image: { hash, dataBlob: 0 }, originalImageWidth: 640 },
		]);
		expect(copy.blobs[0]).toEqual(bytes);
	});

	test("an inline svg icon becomes a vector with a network", () => {
		const path = el("path", box(0, 0, 24, 24), {}, [], { attrs: { d: "M5 12h14M12 5l7 7-7 7" } });
		const circle = el("circle", box(0, 0, 24, 24), {}, [], { attrs: { cx: "12", cy: "12", r: "10" } });

		const svg = el("svg", box(0, 0, 24, 24), { color: "rgb(10, 20, 30)" }, [path, circle], {
			name: "ArrowRight",
			attrs: {
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				"stroke-width": "2",
				"stroke-linecap": "round",
			},
		});

		const { byName, copy } = changes(body([svg]));
		const vector = byName("ArrowRight");

		expect(vector).toMatchObject({ type: "VECTOR", strokeWeight: 2, strokeCap: "ROUND", fillPaints: [] });
		expect(vector?.strokePaints).toMatchObject([{ color: { r: 10 / 255, g: 20 / 255, b: 30 / 255 } }]);
		const blob = copy.blobs[0]!;
		const view = new DataView(blob.buffer);

		expect([view.getUint32(0, true), view.getUint32(4, true), view.getUint32(8, true)]).toEqual([9, 7, 0]);
	});

	test("borders, radii and shadows", () => {
		const card = el(
			"div",
			box(0, 0, 200, 100),
			{
				display: "block",
				"border-top-width": "1px",
				"border-top-style": "solid",
				"border-top-color": "rgb(0, 0, 255)",
				"border-bottom-width": "2px",
				"border-bottom-style": "solid",
				"border-bottom-color": "rgb(0, 0, 255)",
				"border-top-left-radius": "8px",
				"border-top-right-radius": "8px",
				"box-shadow": "rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgb(255, 255, 255) 0px 0px 0px 2px inset",
			},
			[],
			{ name: "Card" },
		);

		const { byName } = changes(body([card]));

		expect(byName("Card")).toMatchObject({
			strokeAlign: "INSIDE",
			borderStrokeWeightsIndependent: true,
			borderTopWeight: 1,
			borderBottomWeight: 2,
			borderLeftWeight: 0,
			rectangleTopLeftCornerRadius: 8,
			rectangleBottomLeftCornerRadius: 0,
			rectangleCornerRadiiIndependent: true,
			effects: [
				{ type: "INNER_SHADOW", spread: 2 },
				{ type: "DROP_SHADOW", offset: { x: 0, y: 4 }, radius: 6, spread: -1 },
			],
		});
	});

	test("plain wrappers fold into their child and layers have names", () => {
		const wrapper = el("div", box(0, 0, 400, 40), { display: "block" }, [row([chip("A", 16)])]);
		const nav = el("nav", box(0, 40, 400, 40), { display: "block", "background-color": "white" }, []);
		const { copy } = changes(body([wrapper, nav]));
		const names = copy.nodeChanges.map((change) => change.name);

		expect(names).toEqual(["Document", "Page 1", "Home", "Row", "A", "nav"]);
	});

	test("the screen is a top-level frame placed as on the canvas", () => {
		const { byName } = changes(body([]));

		expect(byName("Home")).toMatchObject({
			type: "FRAME",
			parentIndex: { guid: { sessionID: 0, localID: 1 } },
			transform: { m02: 100, m12: 50 },
			size: { x: 400, y: 800 },
			frameMaskDisabled: false,
		});
	});
});

describe("round trip through our reader", () => {
	const dashboard = body(
		[
			el(
				"header",
				box(0, 0, 400, 56),
				{
					display: "flex",
					"justify-content": "space-between",
					"align-items": "center",
					"padding-left": "16px",
					"padding-right": "16px",
					"background-color": "rgb(15, 23, 42)",
				},
				[
					el(
						"h1",
						box(16, 18, 80, 20),
						{ display: "block", "font-size": "18px", "font-weight": "600", color: "rgb(255, 255, 255)" },
						[text("Dashboard", box(16, 18, 80, 20))],
					),
					el(
						"button",
						box(300, 12, 84, 32),
						{
							display: "inline-flex",
							"align-items": "center",
							"padding-left": "12px",
							"padding-right": "12px",
							"background-color": "rgb(37, 99, 235)",
						},
						[text("New", box(312, 18, 60, 20))],
					),
				],
			),
			el(
				"main",
				box(0, 56, 400, 236),
				{
					display: "flex",
					"flex-direction": "column",
					"row-gap": "12px",
					"padding-top": "16px",
					"padding-left": "16px",
					"padding-right": "16px",
					"padding-bottom": "16px",
				},
				[chip("Stat", 16, 72, 368, 100), chip("Chart", 16, 184, 368, 92)],
			),
		],
		292,
	);

	test("keeps the tree, names, boxes, text and auto layout", () => {
		const { imported, decoded } = roundTrip(dashboard);
		const root = imported.screens[0]!.root;
		const [header, main] = root.children;

		expect(decoded.message.type).toBe("NODE_CHANGES");
		expect(imported.screens[0]?.title).toBe("Home");
		expect(root.children.map((node) => node.name)).toEqual(["header", "main"]);
		expect(header?.box).toEqual({ x: 0, y: 0, width: 400, height: 56 });
		expect(header?.styles).toMatchObject({
			display: "flex",
			"flex-direction": "row",
			"justify-content": "space-between",
			"align-items": "center",
			"padding-left": "16px",
			"background-color": "rgb(15, 23, 42)",
		});
		expect(header?.children.map((node) => node.name)).toEqual(["Dashboard", 'button "New"']);
		expect(header?.children[0]?.styles).toMatchObject({
			"font-size": "18px",
			"font-weight": "600",
			color: "rgb(255, 255, 255)",
			"line-height": "20px",
		});
		expect(header?.children[0]?.children[0]?.text).toBe("Dashboard");
		expect(main?.styles).toMatchObject({
			display: "flex",
			"flex-direction": "column",
			"row-gap": "12px",
			"padding-top": "16px",
		});
		expect(main?.children.map((node) => [node.name, node.box])).toEqual([
			["Stat", { x: 16, y: 72, width: 368, height: 100 }],
			["Chart", { x: 16, y: 184, width: 368, height: 92 }],
		]);
	});

	test("every node change the reader sees has a known parent", () => {
		const { decoded } = roundTrip(dashboard);
		const nodes = isKiwiList(decoded.message.nodeChanges) ? decoded.message.nodeChanges.filter(isKiwiRecord) : [];
		const key = (record: KiwiRecord | undefined) => (record ? `${record.sessionID}:${record.localID}` : "");
		const ids = new Set(nodes.map((node) => key(isKiwiRecord(node.guid) ? node.guid : undefined)));

		for (const node of nodes) {
			const parent =
				isKiwiRecord(node.parentIndex) && isKiwiRecord(node.parentIndex.guid) ? node.parentIndex.guid : undefined;

			if (node.type !== "DOCUMENT") expect(ids.has(key(parent))).toBe(true);
		}
	});
});

const FONT_FILES = new URL("../../../../node_modules/@fontsource/inter/files/", import.meta.url);

let inter: FontSet | null = null;

async function interFonts() {
	if (inter) return inter;
	const files: FontFile[] = [];

	for (const subset of ["latin", "latin-ext"]) {
		for (const weight of [400, 500, 600, 700]) {
			const file = Bun.file(new URL(`inter-${subset}-${weight}-normal.woff`, FONT_FILES));

			files.push({ weight, unicodeRange: "", bytes: new Uint8Array(await file.arrayBuffer()) });
		}
	}

	inter = fontSet(files);

	return inter;
}

const glyphsOf = (layer: NodeFields | undefined) => layer?.derivedTextData?.glyphs ?? [];

const baselinesOf = (layer: NodeFields | undefined) => [
	...new Set(glyphsOf(layer).map((glyph) => Math.round(glyph.position.y))),
];

function measuredText(value: string, at: CapturedBox, lineWidth: number, size = 14, weight = 400): CapturedNode {
	const glyphs: number[] = [];
	let [x, top] = [at.x, at.y + 3];

	for (const char of value) {
		if (x + 8 > at.x + lineWidth) [x, top] = [at.x, top + 20];

		if (char !== " ") glyphs.push(char.codePointAt(0) ?? 0, x, top, 8, 17, size, weight);
		x += 8;
	}

	return { ...text(value, at), glyphs };
}

describe("text outlines", () => {
	test("measured text draws at its measured lines, inside the layer", async () => {
		const paragraph = el("p", box(0, 0, 80, 40), { display: "block" }, [
			measuredText("Hello world again", box(0, 0, 80, 40), 80),
		]);

		const copy = screensToFigma([screen(body([paragraph]))], await interFonts());
		const layer = copy.nodeChanges.find((change) => change.type === "TEXT");
		const glyphs = glyphsOf(layer);

		expect(glyphs).toHaveLength(15);
		expect(baselinesOf(layer)).toEqual([14, 34]);
		expect(glyphs.every(({ position }) => position.x >= 0 && position.x < 80)).toBe(true);
		expect(glyphs.every((glyph) => glyph.fontSize === 14)).toBe(true);
		expect(new Set(glyphs.map((glyph) => glyph.commandsBlob)).size).toBe(11);
		expect(copy.skipped).toBe(0);
	});

	test("centered text is centered in the layer", async () => {
		const label = el("p", box(0, 0, 200, 20), { display: "block", "text-align": "center" }, [
			measuredText("OK", box(92, 0, 16, 20), 200),
		]);

		const copy = screensToFigma([screen(body([label]))], await interFonts());
		const [first, second] = glyphsOf(copy.nodeChanges.find((change) => change.type === "TEXT"));

		expect(first?.position.x).toBe(92);
		expect(second?.position.x).toBe(100);
	});

	test("unmeasured text is laid out from the font, with word wrap and a line height", async () => {
		const paragraph = el("p", box(0, 0, 120, 40), { display: "block" }, [
			text("Make every screen count", box(0, 0, 120, 40)),
		]);

		const copy = screensToFigma([screen(body([paragraph]))], await interFonts());
		const layer = copy.nodeChanges.find((change) => change.type === "TEXT");
		const widths = glyphsOf(layer).map((glyph) => glyph.position.x + glyph.advance * glyph.fontSize);

		expect(baselinesOf(layer)).toEqual([15, 35]);
		expect(Math.max(...widths)).toBeLessThanOrEqual(120);
	});

	test("truncated text ends with an ellipsis inside its box", async () => {
		const line = el(
			"p",
			box(0, 0, 60, 20),
			{ display: "block", "text-overflow": "ellipsis", "overflow-x": "hidden", "white-space": "nowrap" },
			[measuredText("A very long title", box(0, 0, 136, 20), 1000)],
		);

		const copy = screensToFigma([screen(body([line]))], await interFonts());
		const glyphs = glyphsOf(copy.nodeChanges.find((change) => change.type === "TEXT"));
		const last = glyphs[glyphs.length - 1];

		expect(copy.blobs[last?.commandsBlob ?? -1]).toBeDefined();
		expect((last?.position.x ?? 0) + (last?.advance ?? 0) * 14).toBeLessThanOrEqual(60);
		expect(glyphs.length).toBeLessThan(14);
	});

	test("truncated text in a filled box clips to the box, even when the overflow measures collapsed", async () => {
		const measured = measuredText("A very long title", box(0, 0, 136, 20), 1000);
		const glyphs = (measured.glyphs ?? []).map((value, i) => (i % 7 === 1 ? Math.min(value, 44) : value));

		const line = el(
			"p",
			box(0, 0, 60, 20),
			{
				display: "block",
				"text-overflow": "ellipsis",
				"overflow-x": "hidden",
				"white-space": "nowrap",
				"background-color": "red",
			},
			[{ ...measured, glyphs }],
		);

		const copy = screensToFigma([screen(body([line]))], await interFonts());
		const layer = copy.nodeChanges.find((change) => change.type === "TEXT");
		const drawn = glyphsOf(layer);
		const xs = drawn.map((glyph) => glyph.position.x);
		const last = drawn[drawn.length - 1];

		expect(layer?.size?.x).toBe(60);
		expect(new Set(xs).size).toBe(xs.length);
		expect(copy.blobs[last?.commandsBlob ?? -1]).toBeDefined();
		expect((last?.position.x ?? 0) + (last?.advance ?? 0) * 14).toBeLessThanOrEqual(60);
		expect(last?.advance).toBe((await interFonts())?.outline(0x2026, 400)?.advance ?? -1);
	});

	test("characters the shipped font lacks are skipped and counted", async () => {
		const paragraph = el("p", box(0, 0, 200, 20), { display: "block" }, [text("Hi 你好", box(0, 0, 60, 20))]);
		const copy = screensToFigma([screen(body([paragraph]))], await interFonts());

		expect(glyphsOf(copy.nodeChanges.find((change) => change.type === "TEXT"))).toHaveLength(2);
		expect(copy.skipped).toBe(1);
	});

	test("without fonts text keeps no outlines", () => {
		const { byName } = changes(
			body([el("p", box(0, 0, 200, 20), { display: "block" }, [text("Hi", box(0, 0, 20, 20))])]),
		);

		expect(byName("Hi")?.derivedTextData).toBeUndefined();
	});
});
