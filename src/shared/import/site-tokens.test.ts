import { describe, expect, test } from "bun:test";
import type { CapturedNode } from "./captured-tree";
import { siteTokens } from "./site-tokens";

const box = { x: 0, y: 0, width: 100, height: 20 };

const text = (value: string): CapturedNode => ({ tag: "#text", text: value, box, styles: {}, children: [] });

const node = (
	tag: string,
	styles: Record<string, string>,
	children: CapturedNode[] = [],
	width = 100,
): CapturedNode => ({
	tag,
	box: { ...box, width },
	styles,
	children,
});

const page = (root: CapturedNode, vars: Record<string, string> = {}) => ({
	url: "https://acme.com/",
	tree: { title: "Acme", width: 1280, root },
	vars,
});

describe("siteTokens", () => {
	test("reads body colors, the main button color, radius, border and font", () => {
		const button = node("button", { "background-color": "rgb(225, 29, 72)", "border-top-left-radius": "12px" }, [
			node("span", { color: "rgb(255, 255, 255)" }, [text("Buy now")]),
		]);

		const card = node(
			"div",
			{ "border-top-style": "solid", "border-top-width": "1px", "border-top-color": "rgb(228, 228, 231)" },
			[text("A long paragraph of body copy that sets the foreground."), button],
		);

		const root = node(
			"body",
			{
				"background-color": "rgb(250, 250, 250)",
				color: "rgb(24, 24, 27)",
				"font-family": '-apple-system, "Inter", system-ui, sans-serif',
			},
			[card],
			1280,
		);

		expect(siteTokens(page(root)).light).toEqual({
			background: "#fafafa",
			foreground: "#18181b",
			primary: "#e11d48",
			"primary-foreground": "#ffffff",
			ring: "#e11d48",
			border: "#e4e4e7",
			input: "#e4e4e7",
			radius: "12px",
			"font-sans": '"Inter", system-ui, sans-serif',
		});
	});

	test("takes the page color from a wrapper that fills the body", () => {
		const root = node("body", {}, [node("div", { "background-color": "rgb(9, 9, 11)" }, [text("Hi")], 1280)], 1280);

		expect(siteTokens(page(root)).light.background).toBe("#09090b");
	});

	test("falls back to the link color for primary and picks a readable label", () => {
		const root = node(
			"body",
			{},
			[text("Read the docs"), node("a", { color: "rgb(37, 99, 235)" }, [text("Docs")])],
			1280,
		);

		const { light } = siteTokens(page(root));

		expect(light.primary).toBe("#2563eb");
		expect(light["primary-foreground"]).toBe("#ffffff");
	});

	test("skips see-through fills and the page color", () => {
		const root = node(
			"body",
			{ "background-color": "rgb(255, 255, 255)" },
			[
				node("button", { "background-color": "rgba(0, 0, 0, 0.05)" }, [text("Ghost")]),
				node("button", { "background-color": "rgb(255, 255, 255)" }, [text("Plain")]),
			],
			1280,
		);

		expect(siteTokens(page(root)).light.primary).toBeUndefined();
	});

	test("the site's own variables win when they name Rabisco tokens", () => {
		const root = node("body", { "background-color": "rgb(255, 255, 255)" }, [text("Hi")], 1280);

		const { light } = siteTokens(
			page(root, { "--primary": "oklch(0.55 0.2 264)", "--radius": "0.5rem", "--brand-ink": "#111" }),
		);

		expect(light.primary).toBe("oklch(0.55 0.2 264)");
		expect(light.radius).toBe("0.5rem");
		expect(Object.keys(light)).not.toContain("color-brand-ink");
	});

	test("drops values that aren't valid tokens", () => {
		const root = node("body", { "font-family": "-apple-system", "background-color": "rgb(255, 255, 255)" }, [], 1280);

		expect(siteTokens(page(root, { "--primary": "url(x)" })).light).toEqual({
			background: "#ffffff",
			foreground: "#000000",
		});
	});
});
