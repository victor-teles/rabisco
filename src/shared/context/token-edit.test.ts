import { describe, expect, test } from "bun:test";
import { applyTokenEdit, normalizeTokenName, parseTokenForm, renameError, seedDesignTokens } from "./token-edit";
import { designTokensOf } from "./tokens";

const DESIGN = `# Design

## Tokens

- primary: #2563eb
- color-brand: #ff0066
- radius-card: 12px

### Dark

- primary: #60a5fa
- color-brand: #ff4d94
`;

const TOKENS = designTokensOf(DESIGN);

describe("applyTokenEdit", () => {
	test("set changes one mode's value", () => {
		const next = applyTokenEdit(DESIGN, { kind: "set", name: "color-brand", mode: "dark", value: "#000" });

		expect(designTokensOf(next).dark["color-brand"]).toBe("#000");
		expect(designTokensOf(next).light["color-brand"]).toBe("#ff0066");
	});

	test("set to null removes that mode's value only", () => {
		const next = designTokensOf(applyTokenEdit(DESIGN, { kind: "set", name: "primary", mode: "dark", value: null }));

		expect(next.dark.primary).toBeUndefined();
		expect(next.light.primary).toBe("#2563eb");
	});

	test("add writes both modes, or light alone", () => {
		const both = designTokensOf(
			applyTokenEdit(DESIGN, { kind: "add", name: "spacing-gutter", light: "24px", dark: "20px" }),
		);

		expect(both.light["spacing-gutter"]).toBe("24px");
		expect(both.dark["spacing-gutter"]).toBe("20px");

		const light = designTokensOf(applyTokenEdit(DESIGN, { kind: "add", name: "font-display", light: '"Inter"' }));

		expect(light.light["font-display"]).toBe('"Inter"');
		expect(light.dark["font-display"]).toBeUndefined();
	});

	test("add creates the Tokens section when there is none", () => {
		const next = applyTokenEdit("# Design\n\nProse.\n", { kind: "add", name: "primary", light: "red", dark: "blue" });

		expect(designTokensOf(next)).toEqual({ light: { primary: "red" }, dark: { primary: "blue" } });
		expect(next.startsWith("# Design\n\nProse.")).toBe(true);
	});

	test("remove drops both modes and leaves the rest", () => {
		const next = applyTokenEdit(DESIGN, { kind: "remove", name: "color-brand" });

		expect(designTokensOf(next)).toEqual({
			light: { primary: "#2563eb", "radius-card": "12px" },
			dark: { primary: "#60a5fa" },
		});
	});

	test("rename moves both values to the new name", () => {
		const next = designTokensOf(applyTokenEdit(DESIGN, { kind: "rename", from: "color-brand", to: "color-accent-2" }));

		expect(next.light["color-brand"]).toBeUndefined();
		expect(next.dark["color-brand"]).toBeUndefined();
		expect(next.light["color-accent-2"]).toBe("#ff0066");
		expect(next.dark["color-accent-2"]).toBe("#ff4d94");
	});

	test("renaming to the same name changes nothing", () => {
		expect(applyTokenEdit(DESIGN, { kind: "rename", from: "primary", to: "primary" })).toBe(DESIGN);
	});
});

describe("renameError", () => {
	test("allows a free name of the same kind", () => {
		expect(renameError(TOKENS, "color-brand", "color-hero")).toBeNull();
		expect(renameError(TOKENS, "primary", "primary")).toBeNull();
	});

	test("rejects a taken, unknown or built-in name", () => {
		expect(renameError(TOKENS, "color-brand", "primary")).toContain("already a token");
		expect(renameError(TOKENS, "color-brand", "brand")).toContain("Unknown token name");
		expect(renameError(TOKENS, "color-brand", "color-primary")).toContain("Built in");
	});

	test("rejects a kind the values don't fit", () => {
		expect(renameError(TOKENS, "color-brand", "radius-brand")).toContain("Not a length");
	});
});

describe("parseTokenForm", () => {
	test("normalizes the name and makes an add edit", () => {
		expect(parseTokenForm({ name: " --Color-Hero ", light: " #111 ", dark: "" }, TOKENS)).toEqual({
			edit: { kind: "add", name: "color-hero", light: "#111" },
		});

		expect(parseTokenForm({ name: "text-display", light: "3rem/1.1", dark: "2.5rem" }, TOKENS)).toEqual({
			edit: { kind: "add", name: "text-display", light: "3rem/1.1", dark: "2.5rem" },
		});
	});

	test("reports each field", () => {
		expect(parseTokenForm({ name: "", light: "", dark: "" }, TOKENS).errors).toEqual({ name: "Name the token" });
		expect(parseTokenForm({ name: "color-brand", light: "#000", dark: "" }, TOKENS).errors?.name).toContain(
			"already a token",
		);

		expect(parseTokenForm({ name: "color-hero", light: "", dark: "nope" }, TOKENS).errors).toEqual({
			light: "Give it a light value",
			dark: expect.stringContaining("Not a color"),
		});
	});

	test("normalizeTokenName", () => {
		expect(normalizeTokenName("  --Radius-Card ")).toBe("radius-card");
	});
});

describe("seedDesignTokens", () => {
	const applied = { light: { primary: "#0052ff", "color-brand": "#e11d48" }, dark: { primary: "#3b82f6" } };

	test("writes an AI-read theme into a DESIGN.md without tokens", () => {
		const seeded = seedDesignTokens("# Design\n\nQuiet, one blue accent.\n", applied);
		expect(designTokensOf(seeded)).toEqual(applied);
		expect(
			designTokensOf(applyTokenEdit(seeded, { kind: "set", name: "ring", mode: "light", value: "#000" })).light,
		).toEqual({
			...applied.light,
			ring: "#000",
		});
	});

	test("leaves a DESIGN.md that lists tokens as it is", () => {
		const design = "## Tokens\n\n- primary: #111\n";
		expect(seedDesignTokens(design, applied)).toBe(design);
		expect(seedDesignTokens("# Design\n", undefined)).toBe("# Design\n");
	});
});
