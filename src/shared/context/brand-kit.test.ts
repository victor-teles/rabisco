import { describe, expect, test } from "bun:test";
import { brandKitUrl, contrastRatio, logoPalette, paletteTokens, parseBrandKit, withDesignTokens } from "./brand-kit";
import { designTokensOf } from "./tokens";

describe("brandKitUrl", () => {
	test("adds https and reads GitHub files raw", () => {
		expect(brandKitUrl("example.com/DESIGN.md")).toBe("https://example.com/DESIGN.md");
		expect(brandKitUrl("https://github.com/acme/brand/blob/main/docs/DESIGN.md")).toBe(
			"https://raw.githubusercontent.com/acme/brand/main/docs/DESIGN.md",
		);
	});

	test("rejects empty input and other schemes", () => {
		expect(brandKitUrl("  ")).toBeNull();
		expect(brandKitUrl("file:///etc/passwd")).toBeNull();
		expect(brandKitUrl("javascript:alert(1)")).toBeNull();
	});
});

describe("parseBrandKit", () => {
	test("keeps a Design.md as it is, with its tokens", () => {
		const markdown = "# Acme\n\n## Tokens\n\n- primary: #ff5500\n";
		const kit = parseBrandKit(markdown, "https://x.dev/DESIGN.md", "text/markdown");

		expect(kit).toEqual({ kind: "design", markdown, tokens: { light: { primary: "#ff5500" }, dark: {} } });
	});

	test("reads a shadcn CSS theme, light and dark, and drops what isn't a token", () => {
		const css = `@layer base {
	:root {
		--background: 0 0% 100%;
		--primary: oklch(0.6 0.2 30);
		--radius: 0.75rem;
		--sidebar: red;
		--evil: url(x);
	}
	.dark {
		--primary: #ff8800 !important;
	}
	[data-lang="ar"] {
		--font-sans: Vazirmatn;
	}
}
@theme inline {
	--color-primary: var(--primary);
	--font-sans: Inter, sans-serif;
}`;

		expect(parseBrandKit(css, "https://x.dev/theme.css")).toEqual({
			kind: "tokens",
			tokens: {
				light: {
					background: "hsl(0 0% 100%)",
					primary: "oklch(0.6 0.2 30)",
					radius: "0.75rem",
					"color-sidebar": "red",
					"font-sans": "Inter, sans-serif",
				},
				dark: { primary: "#ff8800" },
			},
		});
	});

	test("reads dark values inside a prefers-color-scheme query", () => {
		const css = ":root { --primary: #111111; }\n@media (prefers-color-scheme: dark) { :root { --primary: #eeeeee; } }";
		const kit = parseBrandKit(css, "https://x.dev/t.css");

		expect(kit.kind === "tokens" && kit.tokens).toEqual({
			light: { primary: "#111111" },
			dark: { primary: "#eeeeee" },
		});
	});

	test("reads a shadcn registry theme", () => {
		const json = JSON.stringify({
			name: "acme",
			cssVars: { theme: { "font-sans": "Geist" }, light: { primary: "#123456" }, dark: { primary: "#abcdef" } },
		});

		expect(parseBrandKit(json, "https://x.dev/r/acme.json", "application/json")).toEqual({
			kind: "tokens",
			tokens: { light: { "font-sans": "Geist", primary: "#123456" }, dark: { primary: "#abcdef" } },
		});
	});

	test("reads nested design tokens", () => {
		const json = JSON.stringify({
			color: {
				primary: { $value: "#0055ff", $type: "color" },
				brand: { value: "#ff0055" },
				dark: { primary: { $value: "#88aaff" } },
			},
			radii: { card: "12px" },
			accent: "#00ff88",
		});

		expect(parseBrandKit(json, "https://x.dev/tokens.json")).toEqual({
			kind: "tokens",
			tokens: {
				light: { primary: "#0055ff", "color-brand": "#ff0055", "radius-card": "12px", accent: "#00ff88" },
				dark: { primary: "#88aaff" },
			},
		});
	});

	test("explains web pages, empty files and files without tokens", () => {
		expect(parseBrandKit("<!doctype html><html></html>", "https://x.dev").kind).toBe("error");
		expect(parseBrandKit("# Docs", "https://x.dev/", "text/html; charset=utf-8").kind).toBe("error");
		expect(parseBrandKit("  \n", "https://x.dev/DESIGN.md").kind).toBe("error");
		expect(parseBrandKit(":root { --nope: 1; }", "https://x.dev/t.css").kind).toBe("error");
		expect(parseBrandKit("{ not json", "https://x.dev/t.json").kind).toBe("error");
	});
});

const image = (...pixels: [number, number, number, number, number][]) =>
	pixels.flatMap(([r, g, b, a, count]) => Array.from({ length: count }, () => [r, g, b, a]).flat());

describe("logoPalette", () => {
	test("makes the most used vivid color primary and skips the background", () => {
		const palette = logoPalette(
			image([255, 255, 255, 255, 600], [230, 40, 40, 255, 300], [30, 60, 200, 255, 100], [0, 0, 0, 0, 500]),
		);

		expect(palette).toEqual({ colors: ["#e62828", "#1e3cc8"], primary: "#e62828" });
		expect(palette && paletteTokens(palette)).toEqual({
			light: {
				primary: "#e62828",
				"primary-foreground": "#ffffff",
				ring: "#e62828",
				"chart-1": "#e62828",
				"chart-2": "#1e3cc8",
			},
			dark: {},
		});
	});

	test("puts the chosen primary first in the charts", () => {
		expect(paletteTokens({ colors: ["#e62828", "#1e3cc8", "#141414"], primary: "#1e3cc8" }).light).toEqual({
			primary: "#1e3cc8",
			"primary-foreground": "#ffffff",
			ring: "#1e3cc8",
			"chart-1": "#1e3cc8",
			"chart-2": "#e62828",
		});
	});

	test("uses the darkest color of a monochrome logo, with readable text on it", () => {
		const palette = logoPalette(image([250, 250, 250, 255, 500], [20, 20, 20, 255, 200], [240, 240, 120, 10, 99]));

		expect(palette && paletteTokens(palette).light).toEqual({
			primary: "#141414",
			"primary-foreground": "#ffffff",
			ring: "#141414",
		});
	});

	test("picks dark text on a light primary", () => {
		const palette = logoPalette(image([250, 220, 60, 255, 100]));

		expect(palette && paletteTokens(palette).light["primary-foreground"]).toBe("#0a0a0a");
	});

	test("has nothing to offer for a blank or transparent image", () => {
		expect(logoPalette(image([0, 0, 0, 0, 50]))).toBeNull();
		expect(logoPalette(image([255, 255, 255, 255, 50]))).toBeNull();
	});
});

describe("withDesignTokens", () => {
	test("writes every token into DESIGN.md and keeps the rest", () => {
		const markdown = withDesignTokens("# Acme\n\n## Tokens\n\n- primary: #000000\n- radius: 4px\n", {
			light: { primary: "#ff0000" },
			dark: { primary: "#00ff00" },
		});

		expect(markdown.startsWith("# Acme")).toBe(true);
		expect(designTokensOf(markdown)).toEqual({
			light: { primary: "#ff0000", radius: "4px" },
			dark: { primary: "#00ff00" },
		});
	});
});

test("contrastRatio is symmetric and 21 for black on white", () => {
	expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
	expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
});
