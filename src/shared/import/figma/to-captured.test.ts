import { describe, expect, test } from "bun:test";
import { compileTsx } from "../../../bun/test-utils";
import { parseCapturedTree } from "../captured-tree";
import { readFigmaClipboard } from "./clipboard";
import { figmaClipboardHtml, type FixtureValue } from "./figma-fixture";
import { figmaScreens } from "./screens";
import { figmaToCaptured } from "./to-captured";

const guid = (localID: number) => ({ sessionID: 1, localID });

const at = (x: number, y: number) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y });

const child = (parent: number, position: string) => ({ guid: guid(parent), position });

const solid = (r: number, g: number, b: number, extra = {}) => ({
	type: "SOLID",
	color: { r, g, b, a: 1 },
	opacity: 1,
	visible: true,
	...extra,
});

const alias = (localID: number) => ({ value: { alias: { guid: { sessionID: 9, localID } } } });

const variable = (localID: number, name: string) => ({ guid: { sessionID: 9, localID }, type: "VARIABLE", name });

const PRICING = [
	variable(1, "Brand/500"),
	variable(2, "Spacing/4"),
	variable(3, "Radius/Card"),
	{
		guid: guid(10),
		parentIndex: child(0, "!"),
		type: "FRAME",
		name: "Pricing",
		size: { x: 390, y: 844 },
		transform: at(800, 120),
		fillPaints: [solid(1, 1, 1)],
		stackMode: "VERTICAL",
		stackSpacing: 16,
		stackHorizontalPadding: 24,
		stackVerticalPadding: 32,
		stackPrimarySizing: "FIXED",
		stackCounterSizing: "FIXED",
		frameMaskDisabled: false,
	},
	{
		guid: guid(11),
		parentIndex: child(10, "a"),
		type: "TEXT",
		name: "Title",
		size: { x: 180, y: 32 },
		transform: at(24, 32),
		fontName: { family: "Inter", style: "Semi Bold Italic", postscript: "" },
		fontSize: 24,
		lineHeight: { value: 32, units: "PIXELS" },
		letterSpacing: { value: -2, units: "PERCENT" },
		textAutoResize: "WIDTH_AND_HEIGHT",
		textCase: "UPPER",
		fillPaints: [solid(0.067, 0.067, 0.067)],
		textData: { characters: "Choose a plan" },
	},
	{
		guid: guid(12),
		parentIndex: child(10, "b"),
		type: "FRAME",
		name: "Card",
		size: { x: 342, y: 72 },
		transform: at(24, 80),
		fillPaints: [solid(0.882, 0.114, 0.282, { colorVar: alias(1) })],
		cornerRadius: 12,
		effects: [
			{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 4 }, radius: 12, visible: true },
		],
		stackMode: "HORIZONTAL",
		stackSpacing: 16,
		stackHorizontalPadding: 16,
		stackVerticalPadding: 16,
		stackPrimaryAlignItems: "SPACE_BETWEEN",
		stackCounterAlignItems: "CENTER",
		stackChildAlignSelf: "STRETCH",
		variableConsumptionMap: {
			entries: [
				{ variableField: "STACK_PADDING_LEFT", variableData: alias(2) },
				{ variableField: "CORNER_RADIUS", variableData: alias(3) },
			],
		},
	},
	{
		guid: guid(13),
		parentIndex: child(12, "a"),
		type: "TEXT",
		name: "Plan",
		size: { x: 40, y: 20 },
		transform: at(16, 26),
		fontSize: 16,
		textAutoResize: "WIDTH_AND_HEIGHT",
		textData: { characters: "Pro\nMonthly" },
	},
	{
		guid: guid(14),
		parentIndex: child(12, "b"),
		type: "FRAME",
		name: "Button / Primary",
		size: { x: 120, y: 40 },
		transform: at(206, 16),
		stackMode: "HORIZONTAL",
		stackChildPrimaryGrow: 1,
		stackCounterSizing: "FIXED",
		strokePaints: [solid(0, 0, 0)],
		strokeWeight: 1,
	},
	{
		guid: guid(15),
		parentIndex: child(10, "c"),
		type: "RECTANGLE",
		name: "Hero photo",
		size: { x: 342, y: 200 },
		transform: at(24, 168),
		fillPaints: [{ type: "IMAGE", visible: true, image: { hash: new Uint8Array([1, 2]) } }],
	},
	{
		guid: guid(16),
		parentIndex: child(10, "d"),
		type: "FRAME",
		name: "Hidden",
		visible: false,
		size: { x: 10, y: 10 },
	},
	{
		guid: guid(17),
		parentIndex: child(10, "e"),
		type: "ELLIPSE",
		name: "Badge",
		size: { x: 24, y: 24 },
		transform: at(350, 8),
		stackPositioning: "ABSOLUTE",
		opacity: 0.5,
		fillPaints: [solid(0, 0.5, 1)],
	},
];

const importOf = (nodes: FixtureValue[]) => figmaToCaptured(readFigmaClipboard(figmaClipboardHtml(nodes)).message);

describe("figmaToCaptured", () => {
	test("turns an auto layout frame into a flex screen", () => {
		const { screens, placeholders } = importOf(PRICING);
		const [screen] = screens;

		expect(screens).toHaveLength(1);
		expect(screen?.title).toBe("Pricing");
		expect(screen?.width).toBe(390);
		expect(placeholders).toBe(1);

		const root = screen?.root;

		expect(root?.box).toEqual({ x: 0, y: 0, width: 390, height: 844 });
		expect(root?.styles).toEqual({
			"background-color": "rgb(255, 255, 255)",
			display: "flex",
			"flex-direction": "column",
			"justify-content": "flex-start",
			"align-items": "flex-start",
			"row-gap": "16px",
			"padding-top": "32px",
			"padding-right": "24px",
			"padding-bottom": "32px",
			"padding-left": "24px",
			"overflow-x": "hidden",
			"overflow-y": "hidden",
			position: "relative",
		});
		expect(root?.children.map((node) => node.tag)).toEqual(["p", "div", "img", "div"]);
	});

	test("keeps text styles and the characters", () => {
		const title = importOf(PRICING).screens[0]?.root.children[0];

		expect(title?.styles).toEqual({
			"font-family": '"Inter"',
			"font-size": "24px",
			"font-weight": "600",
			"font-style": "italic",
			"line-height": "32px",
			"letter-spacing": "-0.48px",
			"text-transform": "uppercase",
			color: "rgb(17, 17, 17)",
		});
		expect(title?.children).toEqual([
			{ tag: "#text", text: "Choose a plan", box: { x: 24, y: 32, width: 180, height: 32 }, styles: {}, children: [] },
		]);

		const plan = importOf(PRICING).screens[0]?.root.children[1]?.children[0];

		expect(plan?.styles["white-space"]).toBe("pre-wrap");
		expect(plan?.box).toEqual({ x: 40, y: 106, width: 40, height: 20 });
	});

	test("maps fills, radius, shadow and variables to tokens, skipping names that are not tokens", () => {
		const { screens, tokens } = importOf(PRICING);
		const card = screens[0]?.root.children[1];

		expect(card?.styles).toMatchObject({
			"background-color": "rgb(225, 29, 72)",
			"border-top-left-radius": "12px",
			"border-bottom-right-radius": "12px",
			"box-shadow": "0px 4px 12px 0px rgba(0, 0, 0, 0.1)",
			"flex-direction": "row",
			"justify-content": "space-between",
			"align-items": "center",
			"align-self": "stretch",
			"padding-left": "16px",
		});
		expect(card?.styles["column-gap"]).toBeUndefined();
		expect(card?.styles.width).toBeUndefined();
		expect(card?.tokens).toEqual({
			"background-color": "color-brand-500",
			"border-top-left-radius": "radius-card",
			"border-top-right-radius": "radius-card",
			"border-bottom-right-radius": "radius-card",
			"border-bottom-left-radius": "radius-card",
		});
		expect(tokens).toEqual([
			{ name: "color-brand-500", value: "rgb(225, 29, 72)" },
			{ name: "radius-card", value: "12px" },
		]);
	});

	test("sizes fill, fixed and hug children", () => {
		const root = importOf(PRICING).screens[0]?.root;
		const button = root?.children[1]?.children[1];
		const photo = root?.children[2];

		expect(button?.tag).toBe("button");
		expect(button?.styles).toMatchObject({ "flex-grow": "1", "flex-basis": "0px", height: "40px" });
		expect(button?.styles.width).toBeUndefined();
		expect(button?.styles["border-left-width"]).toBe("1px");
		expect(photo?.attrs).toEqual({ alt: "Hero photo" });
		expect(photo?.styles).toMatchObject({ width: "342px", height: "200px", "flex-shrink": "0" });
	});

	test("places absolute children and skips hidden ones", () => {
		const root = importOf(PRICING).screens[0]?.root;
		const badge = root?.children[3];

		expect(root?.children.some((node) => node.box.width === 10)).toBe(false);
		expect(badge?.styles).toMatchObject({
			position: "absolute",
			left: "350px",
			top: "8px",
			opacity: "0.5",
			"border-top-left-radius": "9999px",
		});
	});

	test("wraps loose layers in one screen and gives each frame its own", () => {
		const loose = importOf([
			{ guid: guid(1), parentIndex: child(0, "a"), type: "TEXT", size: { x: 50, y: 20 }, transform: at(100, 100) },
			{ guid: guid(2), parentIndex: child(0, "b"), type: "RECTANGLE", size: { x: 40, y: 40 }, transform: at(200, 140) },
		]);

		expect(loose.screens).toHaveLength(1);
		expect(loose.screens[0]?.width).toBe(140);
		expect(loose.screens[0]?.root.children.map((node) => [node.styles.left, node.styles.top])).toEqual([
			["0px", "0px"],
			["100px", "40px"],
		]);

		const frames = importOf([
			{ guid: guid(1), parentIndex: child(0, "b"), type: "FRAME", name: "Second", size: { x: 10, y: 10 } },
			{ guid: guid(2), parentIndex: child(0, "a"), type: "FRAME", name: "First", size: { x: 10, y: 10 } },
		]);

		expect(frames.screens.map((screen) => screen.title)).toEqual(["First", "Second"]);
	});

	test("passes the shared tree validator", () => {
		const [screen] = importOf(PRICING).screens;
		const parsed = parseCapturedTree(JSON.stringify(screen));

		expect(parsed?.root.children[1]?.tokens).toEqual(screen?.root.children[1]?.tokens);
		expect(parsed?.root.children[0]?.children[0]?.text).toBe("Choose a plan");
		expect(parsed?.root.children[2]?.attrs).toEqual({ alt: "Hero photo" });
	});

	test("writes an editable flex screen that uses the Figma variables as tokens", () => {
		const { screens, tokens, placeholders } = importOf(PRICING);
		const project = { "radius-card": "8px" };
		const result = figmaScreens(screens, tokens, project, project, placeholders);
		const source = result.screens[0]?.source ?? "";

		expect(result.added).toEqual({ "color-brand-500": "rgb(225, 29, 72)" });
		expect(result.kept).toEqual(["radius-card"]);
		expect(result.placeholders).toBe(1);
		expect(result.screens[0]).toMatchObject({ name: "Pricing", width: 390, height: 844 });
		expect(source).toContain(
			'className="min-h-full flex flex-col items-start gap-y-4 relative overflow-hidden py-8 px-6',
		);
		expect(source).toContain(
			'className="flex justify-between items-center self-stretch p-4 bg-brand-500 rounded-card shadow-',
		);
		expect(source).toContain('<Placeholder label="Hero photo"');
		expect(source).toContain('<button className="flex items-start grow');
		expect(source).not.toContain("style=");
		expect(() => compileTsx(source)).not.toThrow();
	});
});
