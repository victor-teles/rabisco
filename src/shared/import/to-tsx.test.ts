import { describe, expect, test } from "bun:test";
import type { CapturedNode, CapturedTree } from "./captured-tree";
import { componentName, treeToTsx } from "./to-tsx";

const THEME = {
	radius: "0.625rem",
	background: "oklch(1 0 0)",
	foreground: "oklch(0.145 0 0)",
	primary: "oklch(0.205 0 0)",
	"primary-foreground": "oklch(0.985 0 0)",
	muted: "oklch(0.97 0 0)",
	"muted-foreground": "oklch(0.556 0 0)",
	border: "oklch(0.922 0 0)",
};

const BOX = { x: 0, y: 0, width: 200, height: 80 };

const el = (
	tag: string,
	styles: Record<string, string>,
	children: CapturedNode[] = [],
	extra: Partial<CapturedNode> = {},
): CapturedNode => ({ tag, box: BOX, styles, children, ...extra });

const text = (value: string): CapturedNode => ({ tag: "#text", text: value, box: BOX, styles: {}, children: [] });

const tree = (children: CapturedNode[], styles: Record<string, string> = {}): CapturedTree => ({
	title: "Pricing page",
	width: 1440,
	root: { tag: "body", box: { x: 0, y: 0, width: 1440, height: 900 }, styles, children },
});

describe("treeToTsx", () => {
	test("writes a screen component named after the title, with token colors on the root", () => {
		const screen = treeToTsx(
			tree([el("h1", { display: "block", "font-size": "36px", "font-weight": "700" }, [text("Plans")])]),
			THEME,
		);

		expect(screen.name).toBe("Pricing page");
		expect(screen.width).toBe(1440);
		expect(screen.height).toBe(900);
		expect(screen.source).toBe(
			[
				"export default function PricingPage() {",
				"\treturn (",
				'\t\t<div className="min-h-full bg-background text-foreground">',
				'\t\t\t<h1 className="text-4xl font-bold">Plans</h1>',
				"\t\t</div>",
				"\t);",
				"}",
				"",
			].join("\n"),
		);
	});

	test("maps flex layout, spacing, radius and shadow to scale classes", () => {
		const card = el("div", {
			display: "flex",
			"flex-direction": "column",
			"align-items": "center",
			"justify-content": "space-between",
			"row-gap": "16px",
			"column-gap": "16px",
			"padding-top": "24px",
			"padding-bottom": "24px",
			"padding-left": "32px",
			"padding-right": "32px",
			"border-top-left-radius": "10px",
			"border-top-right-radius": "10px",
			"border-bottom-right-radius": "10px",
			"border-bottom-left-radius": "10px",
			"box-shadow": "rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px",
		});

		const { source } = treeToTsx(tree([card]), THEME);

		expect(source).toContain(
			'<div className="flex flex-col justify-between items-center gap-4 py-6 px-8 rounded-lg shadow-sm" />',
		);
	});

	test("matches colors to tokens first, then the palette, then an arbitrary value it reports", () => {
		const { source, untokened } = treeToTsx(
			tree([
				el("p", { display: "block", color: "rgb(115, 115, 115)" }, [text("Muted")]),
				el("p", { display: "block", color: "rgb(21, 93, 252)" }, [text("Blue")]),
				el("p", { display: "block", color: "rgb(236, 0, 63)", "background-color": "rgb(18, 52, 86)" }, [text("Odd")]),
				el("div", { display: "block", "background-color": "rgba(0, 0, 0, 0.5)" }),
			]),
			THEME,
		);

		expect(source).toContain('<p className="text-muted-foreground">Muted</p>');
		expect(source).toContain('<p className="text-blue-600">Blue</p>');
		expect(source).toContain('<p className="bg-[#123456] text-rose-600">Odd</p>');
		expect(source).toContain('<div className="bg-black/50" />');
		expect(untokened).toEqual({ colors: 1, radii: 0 });
	});

	test("breaks ties between equal tokens by role, then by theme order", () => {
		const { source } = treeToTsx(
			tree([
				el("div", { display: "block", "background-color": "rgb(255, 255, 255)" }),
				el("p", { display: "block", color: "rgb(255, 255, 255)" }, [text("On dark")]),
			]),
			{ ...THEME, card: "#ffffff", popover: "#ffffff", "card-foreground": "#ffffff" },
		);

		expect(source).toContain('<div className="bg-background" />');
		expect(source).toContain('<p className="text-card-foreground">On dark</p>');
	});

	test("uses project tokens for custom colors, font sizes and radii", () => {
		const theme = { ...THEME, "color-brand": "#e11d48", "text-display": "3.5rem", "radius-card": "20px" };

		const { source } = treeToTsx(
			tree([
				el(
					"h2",
					{
						display: "block",
						color: "rgb(225, 29, 72)",
						"font-size": "56px",
						"border-top-left-radius": "20px",
						"border-top-right-radius": "20px",
						"border-bottom-right-radius": "20px",
						"border-bottom-left-radius": "20px",
					},
					[text("Hello")],
				),
			]),
			theme,
		);

		expect(source).toContain('<h2 className="rounded-card text-display text-brand">Hello</h2>');
	});

	test("prefers a bound token over the value", () => {
		const node = el("div", { display: "block", "background-color": "rgb(1, 2, 3)" }, [], {
			tokens: { "background-color": "color-brand-500" },
		});

		expect(treeToTsx(tree([node]), THEME).source).toContain('<div className="bg-brand-500" />');
	});

	test("writes inherited text styles only where they change, and leading only when it isn't the size's own", () => {
		const { source } = treeToTsx(
			tree([
				el("section", { display: "block", color: "rgb(21, 93, 252)", "font-size": "14px", "line-height": "20px" }, [
					el("p", { display: "block" }, [text("Same")]),
					el("p", { display: "block", "line-height": "24px", "letter-spacing": "-0.35px" }, [text("Loose")]),
				]),
			]),
			THEME,
		);

		expect(source).toContain('<section className="text-sm text-blue-600">');
		expect(source).toContain("<p>Same</p>");
		expect(source).toContain('<p className="leading-6 tracking-tight">Loose</p>');
	});

	test("merges wrappers that have no styles of their own and keeps semantic tags", () => {
		const { source } = treeToTsx(
			tree([
				el("div", {}, [
					el("nav", { display: "flex", "column-gap": "8px" }, [
						el("a", { display: "inline", "text-decoration-line": "none" }, [text("Home")], { attrs: { href: "/" } }),
					]),
				]),
			]),
			THEME,
		);

		expect(source).toContain('\t\t\t<nav className="flex gap-x-2">\n\t\t\t\t<a href="/">Home</a>\n\t\t\t</nav>');
	});

	test("keeps spaces between inline children and escapes JSX characters", () => {
		const { source } = treeToTsx(
			tree([
				el("p", { display: "block" }, [
					text("Save "),
					el("strong", { display: "inline", "font-weight": "700" }, [text("20%")]),
					text(" with {annual} billing"),
				]),
			]),
			THEME,
		);

		expect(source).toContain(
			[
				"\t\t\t<p>",
				'\t\t\t\tSave{" "}',
				'\t\t\t\t<strong className="font-bold">20%</strong>{" "}',
				'\t\t\t\t{"with {annual} billing"}',
				"\t\t\t</p>",
			].join("\n"),
		);
	});

	test("turns images without a project src into placeholders and keeps project images", () => {
		const { source } = treeToTsx(
			tree([
				el("img", { display: "inline", width: "48px", height: "48px" }, [], {
					attrs: { alt: "Avatar", src: "https://x.test/a.png" },
				}),
				el("img", { display: "block", width: "100%" }, [], {
					attrs: { alt: "Hero", src: "/images/imported/hero.png" },
				}),
			]),
			THEME,
		);

		expect(source.startsWith('import { Placeholder } from "@/components/ui/placeholder";\n\n')).toBe(true);
		expect(source).toContain('<Placeholder label="Avatar" className="inline size-12" />');
		expect(source).toContain('<img src="/images/imported/hero.png" alt="Hero" className="w-full" />');
	});

	test("writes absolute boxes with their offsets and size", () => {
		const { source } = treeToTsx(
			tree([
				el("div", { display: "block", position: "relative" }, [
					el("span", {
						display: "block",
						position: "absolute",
						top: "8px",
						right: "-4px",
						width: "13px",
						height: "13px",
					}),
				]),
			]),
			THEME,
		);

		expect(source).toContain('<span className="block absolute top-2 -right-1 size-[13px]" />');
	});

	test("maps margins, borders, grids and lists", () => {
		const { source } = treeToTsx(
			tree([
				el("main", { display: "block", "max-width": "1280px", "margin-left": "auto", "margin-right": "auto" }, [
					el("ul", {
						display: "grid",
						"grid-template-columns": "200px 200px 200px",
						"row-gap": "24px",
						"column-gap": "24px",
						"list-style-type": "none",
					}),
					el("div", {
						display: "block",
						"border-top-style": "solid",
						"border-top-width": "1px",
						"border-top-color": "oklch(0.922 0 0)",
						"margin-top": "-8px",
					}),
				]),
			]),
			THEME,
		);

		expect(source).toContain('<main className="max-w-7xl mx-auto">');
		expect(source).toContain('<ul className="grid grid-cols-3 gap-6" />');
		expect(source).toContain('<div className="-mt-2 border-t" />');
	});

	test("keeps inline SVG with JSX attribute names", () => {
		const icon = el(
			"svg",
			{ display: "block", width: "24px", height: "24px" },
			[el("path", {}, [], { attrs: { d: "M0 0h24", "stroke-width": "2" } })],
			{
				attrs: { viewBox: "0 0 24 24", fill: "none" },
			},
		);

		const { source } = treeToTsx(tree([icon]), THEME);

		expect(source).toContain('<svg viewBox="0 0 24 24" fill="none" className="size-6">');
		expect(source).toContain('<path d="M0 0h24" strokeWidth="2" />');
	});

	test("is deterministic", () => {
		const input = tree([el("p", { display: "block", color: "rgb(1, 2, 3)" }, [text("x")])]);

		expect(treeToTsx(input, THEME)).toEqual(treeToTsx(input, THEME));
	});
});

describe("componentName", () => {
	test("makes a component name from a page title", () => {
		expect(componentName("Acme — Pricing & plans")).toBe("AcmePricingPlans");
		expect(componentName("404")).toBe("Screen404");
		expect(componentName("")).toBe("Imported");
	});
});
