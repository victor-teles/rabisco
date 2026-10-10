import { describe, expect, test } from "bun:test";
import { contrastRatio } from "../design/layout-checks";
import { parseColor } from "../export/color";
import { contextBody } from "./body";
import {
	AUTO_STYLE,
	STYLE_IDS,
	STYLES,
	autoDesignOf,
	isStyleId,
	lacksDesignDirection,
	starterFiles,
	styleById,
	styleDesign,
	withDesign,
	withStyle,
} from "./styles";
import { CONTEXT_TEMPLATES } from "./templates";
import { themeUpdateOf, type AppliedTheme } from "./theme";
import { parseDesignTokens } from "./tokens";
import type { ProjectFiles } from "../types";

/** Text on its fill; muted text also sits on the page */
const PAIRS = [
	["foreground", "background"],
	["card-foreground", "card"],
	["primary-foreground", "primary"],
	["secondary-foreground", "secondary"],
	["muted-foreground", "muted"],
	["muted-foreground", "background"],
	["accent-foreground", "accent"],
	["color-brand-foreground", "color-brand"],
] as const;

function contrast(tokens: Record<string, string>, text: string, fill: string) {
	const a = tokens[text] === undefined ? null : parseColor(tokens[text]);
	const b = tokens[fill] === undefined ? null : parseColor(tokens[fill]);

	return a && b ? contrastRatio(a, b) : null;
}

describe("styles", () => {
	test("has one style per id", () => {
		expect(STYLES.map((style) => style.id)).toEqual([...STYLE_IDS]);
		expect(isStyleId("editorial")).toBe(true);
		expect(isStyleId("neon")).toBe(false);
		expect(isStyleId(null)).toBe(false);
	});

	for (const style of STYLES) {
		describe(style.label, () => {
			const parsed = parseDesignTokens(styleDesign(style.id));

			test("every token is valid and read back", () => {
				expect(parsed.invalid).toEqual([]);
				expect(parsed.light).toEqual(style.light);
				expect(parsed.dark).toEqual(style.dark);
			});

			test("text reaches 4.5:1 on its fill, light and dark", () => {
				for (const mode of [parsed.light, { ...parsed.light, ...parsed.dark }]) {
					for (const [text, fill] of PAIRS) {
						const ratio = contrast(mode, text, fill);

						if (ratio !== null) expect({ text, fill, ok: ratio >= 4.5 }).toEqual({ text, fill, ok: true });
					}
				}
			});

			test("counts as real context, not a template", () => {
				expect(contextBody(styleDesign(style.id))).toBeTruthy();
				expect(styleDesign(style.id)).not.toContain("<!--");
			});
		});
	}
});

describe("starterFiles", () => {
	test("keeps the templates without a style", () => {
		expect(starterFiles(null)).toEqual(CONTEXT_TEMPLATES);
	});

	test("writes the style's DESIGN.md and the PRODUCT.md template", () => {
		const files = starterFiles("bold");

		expect(files["DESIGN.md"]).toBe(styleDesign("bold"));
		expect(files["PRODUCT.md"]).toBe(CONTEXT_TEMPLATES["PRODUCT.md"]);
	});
});

describe("lacksDesignDirection", () => {
	test("is true for a missing or untouched DESIGN.md", () => {
		expect(lacksDesignDirection(undefined)).toBe(true);
		expect(lacksDesignDirection("")).toBe(true);
		expect(lacksDesignDirection(CONTEXT_TEMPLATES["DESIGN.md"])).toBe(true);
	});

	test("is false once DESIGN.md says anything", () => {
		expect(lacksDesignDirection(styleDesign("minimal"))).toBe(false);
		expect(lacksDesignDirection("# Design\n\nWarm and quiet.")).toBe(false);
	});
});

/** The parts of a project snapshot `withStyle` reads and writes */
type StyledProject = { frames: string[]; files: ProjectFiles; theme?: AppliedTheme };

describe("withStyle", () => {
	const project: StyledProject = {
		frames: [],
		files: { ...CONTEXT_TEMPLATES, "home.tsx": "export default () => null" },
	};

	test("writes DESIGN.md and applies its tokens, so no theme prompt follows", () => {
		const next = withStyle(project, "editorial");

		expect(next.files["DESIGN.md"]).toBe(styleDesign("editorial"));
		expect(next.files["home.tsx"]).toBe(project.files["home.tsx"]);
		expect(next.frames).toBe(project.frames);
		const theme = next.theme ?? { light: {}, dark: {} };

		expect(theme.light).toEqual(styleById("editorial").light);
		expect(theme.dark).toEqual(styleById("editorial").dark);
		expect(themeUpdateOf(theme, next.files["DESIGN.md"])).toBeNull();
	});

	test("keeps a DESIGN.md that already has a direction", () => {
		const written = { ...project, files: { ...project.files, "DESIGN.md": "# Design\n\nWarm and quiet." } };

		expect(withStyle(written, "bold")).toBe(written);
	});
});

describe("Auto style", () => {
	const DESIGN = "# Design\n\n## Tokens\n\n- primary: #0f766e\n- radius: 1rem\n\n## Visual direction\n\nSoft.\n";

	test("is not a preset id", () => {
		expect(isStyleId(AUTO_STYLE)).toBe(false);
	});

	test("a written DESIGN.md is kept only when it has tokens", () => {
		expect(autoDesignOf(DESIGN)).toBe(DESIGN);
		expect(autoDesignOf("# Design\n\nSoft and calm, no tokens.\n")).toBeNull();
		expect(autoDesignOf("# Design\n\n## Tokens\n\n- primary: not-a-color\n")).toBeNull();
		expect(autoDesignOf(undefined)).toBeNull();
	});

	test("withDesign writes DESIGN.md and applies its tokens, with their source, in one snapshot", () => {
		const next = withDesign<StyledProject>(
			{ frames: [], files: { "DESIGN.md": CONTEXT_TEMPLATES["DESIGN.md"] } },
			DESIGN,
		);

		expect(next.files["DESIGN.md"]).toBe(DESIGN);
		expect(next.theme?.light).toEqual({ primary: "#0f766e", radius: "1rem" });
		expect(themeUpdateOf(next.theme!, DESIGN)).toBeNull();
	});
});
