import { describe, expect, test } from "bun:test";
import { detachTokenUsages, rawTokenMatches, renameTokenUsages, replaceRawMatches, tokenUsages } from "./token-usage";
import type { DesignTokens } from "./tokens";

const TOKENS: DesignTokens = {
	light: {
		primary: "#2563eb",
		"primary-foreground": "#ffffff",
		background: "#ffffff",
		"color-brand": "#e11d48",
		"radius-card": "1.25rem",
		"spacing-gutter": "24px",
		"text-heading": "2rem/1.2 600 -0.01em",
		"text-caption": "0.75rem",
		"shadow-card": "0 4px 12px rgb(0 0 0 / 0.1)",
		"font-weight-heavy": "650",
		"font-display": '"Fraunces", serif',
	},
	dark: { "color-brand": "#fb7185" },
};

const screen = (classes: string) =>
	`export default function Screen() {\n\treturn <div className="${classes}">Hi</div>;\n}\n`;

describe("tokenUsages", () => {
	test("counts classes in every kind, with variants, sides and opacity, and var() references", () => {
		const files = {
			"screens/home.tsx": screen("bg-brand hover:text-brand/50 rounded-t-card -mt-gutter shadow-card font-heavy"),
			"components/card.tsx": `export function Card() {\n\treturn <p className={cn("text-heading p-4", x)} style={{ color: "var(--color-brand)" }} />;\n}\n`,
			"DESIGN.md": "bg-brand",
		};

		const usages = tokenUsages(files, TOKENS);

		expect(usages.get("color-brand")).toEqual({ count: 3, paths: ["screens/home.tsx", "components/card.tsx"] });
		expect(usages.get("radius-card")?.count).toBe(1);
		expect(usages.get("spacing-gutter")?.count).toBe(1);
		expect(usages.get("shadow-card")?.count).toBe(1);
		expect(usages.get("font-weight-heavy")?.count).toBe(1);
		expect(usages.get("text-heading")?.paths).toEqual(["components/card.tsx"]);
		expect(usages.has("text-caption")).toBe(false);
	});
});

describe("renameTokenUsages", () => {
	test("rewrites classes and var() references, keeping variants and modifiers", () => {
		const files = {
			"screens/home.tsx": `${screen("bg-brand md:hover:!border-x-brand/40 text-brand-dark")}const c = "var(--color-brand)";\n`,
			"screens/other.tsx": screen("p-4"),
		};

		expect(renameTokenUsages(files, "color-brand", "color-brand-strong")).toEqual({
			"screens/home.tsx": `${screen("bg-brand-strong md:hover:!border-x-brand-strong/40 text-brand-dark")}const c = "var(--color-brand-strong)";\n`,
		});
	});

	test("a built-in color can become a custom one", () => {
		expect(
			renameTokenUsages({ "screens/a.tsx": screen("bg-primary text-primary-foreground") }, "primary", "color-ink"),
		).toEqual({
			"screens/a.tsx": screen("bg-ink text-primary-foreground"),
		});
	});
});

describe("detachTokenUsages", () => {
	test("writes the value back, with a dark class for a dark value", () => {
		const files = { "screens/a.tsx": screen("bg-brand/50 p-4") };

		expect(detachTokenUsages(files, "color-brand", TOKENS)["screens/a.tsx"]).toBe(
			screen("bg-[#e11d48]/50 dark:bg-[#fb7185]/50 p-4"),
		);
	});

	test("text styles become size, line height, weight and tracking", () => {
		const files = { "screens/a.tsx": screen("md:text-heading") };

		expect(detachTokenUsages(files, "text-heading", TOKENS)["screens/a.tsx"]).toBe(
			screen("md:text-[2rem]/[1.2] md:font-[600] md:tracking-[-0.01em]"),
		);
	});

	test("shadows, fonts and var() references", () => {
		const files = {
			"screens/a.tsx": `${screen("shadow-card font-display")}const s = { boxShadow: "var(--shadow-card)" };\n`,
		};

		expect(detachTokenUsages(files, "shadow-card", TOKENS)["screens/a.tsx"]).toBe(
			`${screen("shadow-[0_4px_12px_rgb(0_0_0_/_0.1)] font-display")}const s = { boxShadow: "0 4px 12px rgb(0 0 0 / 0.1)" };\n`,
		);
		expect(detachTokenUsages(files, "font-display", TOKENS)["screens/a.tsx"]).toContain(
			"font-[family-name:Fraunces,serif]",
		);
	});

	test("rounded-sm to rounded-xl keep their offset from radius", () => {
		const tokens = { light: { radius: "0.5rem" }, dark: {} };

		expect(
			detachTokenUsages({ "screens/a.tsx": screen("rounded-sm rounded-lg") }, "radius", tokens)["screens/a.tsx"],
		).toBe(screen("rounded-[calc(0.5rem_-_4px)] rounded-[0.5rem]"));
	});
});

describe("rawTokenMatches", () => {
	test("finds arbitrary values and palette colors equal to a token, and replaces them", () => {
		const files = {
			"screens/a.tsx": screen(
				"bg-[#E11D48] text-[#fff] bg-[#ffffff] rounded-[20px] p-[1.5rem] text-[0.75rem] shadow-[0_4px_12px_rgb(0_0_0_/_0.1)] font-[650] bg-[#123456] text-[2rem]",
			),
			"screens/b.tsx": screen("border-blue-600 hover:bg-[rgb(225_29_72)]/50"),
		};

		const matches = rawTokenMatches(files, TOKENS);

		expect(matches.map((match) => `${match.raw} → ${match.replacement}`)).toEqual([
			"bg-[#E11D48] → bg-brand",
			"text-[#fff] → text-primary-foreground",
			"bg-[#ffffff] → bg-background",
			"rounded-[20px] → rounded-card",
			"p-[1.5rem] → p-gutter",
			"text-[0.75rem] → text-caption",
			"shadow-[0_4px_12px_rgb(0_0_0_/_0.1)] → shadow-card",
			"font-[650] → font-heavy",
			"hover:bg-[rgb(225_29_72)]/50 → hover:bg-brand/50",
		]);

		expect(replaceRawMatches(files, matches)).toEqual({
			"screens/a.tsx": screen(
				"bg-brand text-primary-foreground bg-background rounded-card p-gutter text-caption shadow-card font-heavy bg-[#123456] text-[2rem]",
			),
			"screens/b.tsx": screen("border-blue-600 hover:bg-brand/50"),
		});
	});

	test("palette classes match a token with the same color", () => {
		const tokens = { light: { "color-brand": "oklch(54.6% 0.245 262.881)" }, dark: {} };

		expect(rawTokenMatches({ "screens/a.tsx": screen("bg-blue-600") }, tokens)[0]?.replacement).toBe("bg-brand");
	});
});
