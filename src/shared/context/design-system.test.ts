import { describe, expect, test } from "bun:test";
import { applyDesignSystemChange } from "./design-system";
import { rawTokenMatches } from "./token-usage";
import { designTokensOf } from "./tokens";

const DESIGN = "# Design\n\n## Tokens\n\n- color-brand: #e11d48\n";

const screen = (classes: string) => `export default function Home() {\n\treturn <div className="${classes}" />;\n}\n`;

const FILES = { "DESIGN.md": DESIGN, "screens/home.tsx": screen("bg-brand p-4") };

describe("applyDesignSystemChange", () => {
	test("a rename writes DESIGN.md and the screens together", () => {
		const files = applyDesignSystemChange(FILES, undefined, {
			kind: "token",
			edit: { kind: "rename", from: "color-brand", to: "color-ink" },
		});

		expect(designTokensOf(files["DESIGN.md"]).light).toEqual({ "color-ink": "#e11d48" });
		expect(files["screens/home.tsx"]).toBe(screen("bg-ink p-4"));
	});

	test("remove can detach the uses first, or leave them", () => {
		const detached = applyDesignSystemChange(FILES, undefined, { kind: "remove", name: "color-brand", detach: true });
		const kept = applyDesignSystemChange(FILES, undefined, { kind: "remove", name: "color-brand", detach: false });

		expect(designTokensOf(detached["DESIGN.md"]).light).toEqual({});
		expect(detached["screens/home.tsx"]).toBe(screen("bg-[#e11d48] p-4"));
		expect(kept["screens/home.tsx"]).toBe(screen("bg-brand p-4"));
	});

	test("detach leaves DESIGN.md; raw values become token classes", () => {
		const detached = applyDesignSystemChange(FILES, undefined, { kind: "detach", name: "color-brand" });

		expect(detached["DESIGN.md"]).toBe(DESIGN);
		expect(detached["screens/home.tsx"]).toBe(screen("bg-[#e11d48] p-4"));

		const matches = rawTokenMatches(detached, designTokensOf(DESIGN));

		expect(applyDesignSystemChange(detached, undefined, { kind: "replace-raw", matches })["screens/home.tsx"]).toBe(
			screen("bg-brand p-4"),
		);
	});

	test("a theme read with AI is written into DESIGN.md before the change", () => {
		const files = applyDesignSystemChange(
			{ "DESIGN.md": "# Design\n\nProse only.\n", "screens/home.tsx": screen("bg-brand") },
			{ light: { "color-brand": "#123456" }, dark: {} },
			{ kind: "detach", name: "color-brand" },
		);

		expect(files["screens/home.tsx"]).toBe(screen("bg-[#123456]"));
	});
});
