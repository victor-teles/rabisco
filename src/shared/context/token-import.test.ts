import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../json";
import { parseBrandKit } from "./brand-kit";

const tokensOf = (json: JsonObject) => {
	const kit = parseBrandKit(JSON.stringify(json), "https://x.dev/tokens.json");

	return kit.kind === "tokens" ? kit.tokens : kit;
};

describe("DTCG", () => {
	test("reads 2025 values, inherited types and references", () => {
		expect(
			tokensOf({
				color: {
					$type: "color",
					brand: { $value: { colorSpace: "srgb", components: [1, 0, 0.4] } },
					ink: { $value: { colorSpace: "oklch", components: [0.3, 0.05, 250], alpha: 0.9 } },
					primary: { $value: "{color.brand}" },
				},
				radius: { card: { $type: "dimension", $value: { value: 12, unit: "px" } } },
				fontWeight: { heavy: { $type: "fontWeight", $value: "extra-bold" } },
				font: { display: { $type: "fontFamily", $value: ["Fraunces Variable", "serif"] } },
				shadow: {
					card: {
						$type: "shadow",
						$value: {
							color: "{color.brand}",
							offsetX: { value: 0, unit: "px" },
							offsetY: { value: 4, unit: "px" },
							blur: { value: 12, unit: "px" },
							spread: { value: 0, unit: "px" },
						},
					},
				},
				typography: {
					heading: {
						$type: "typography",
						$value: {
							fontFamily: "Inter",
							fontSize: { value: 2, unit: "rem" },
							fontWeight: 600,
							lineHeight: 1.2,
							letterSpacing: { value: -0.01, unit: "em" },
						},
					},
				},
			}),
		).toEqual({
			light: {
				"color-brand": "#ff0066",
				"color-ink": "oklch(0.3 0.05 250 / 0.9)",
				primary: "#ff0066",
				"radius-card": "12px",
				"font-weight-heavy": "800",
				"font-display": '"Fraunces Variable", serif',
				"shadow-card": "0px 4px 12px 0px #ff0066",
				"text-heading": "2rem/1.2 600 -0.01em",
			},
			dark: {},
		});
	});
});

describe("Figma variables", () => {
	test("reads the default mode as light and a Dark mode as dark, following aliases", () => {
		const collection = {
			id: "c1",
			defaultModeId: "m1",
			modes: [
				{ modeId: "m1", name: "Light" },
				{ modeId: "m2", name: "Dark" },
			],
		};

		const variables = {
			v1: {
				id: "v1",
				name: "Colors/Brand",
				resolvedType: "COLOR",
				variableCollectionId: "c1",
				valuesByMode: { m1: { r: 1, g: 0, b: 0.4, a: 1 }, m2: { r: 1, g: 0.5, b: 0.6, a: 1 } },
			},
			v2: {
				id: "v2",
				name: "Colors/Primary",
				resolvedType: "COLOR",
				variableCollectionId: "c1",
				valuesByMode: { m1: { type: "VARIABLE_ALIAS", id: "v1" }, m2: { type: "VARIABLE_ALIAS", id: "v1" } },
			},
			v3: {
				id: "v3",
				name: "Radius/Card",
				resolvedType: "FLOAT",
				variableCollectionId: "c1",
				valuesByMode: { m1: 12, m2: 12 },
			},
			v4: { id: "v4", name: "Opacity", resolvedType: "FLOAT", variableCollectionId: "c1", valuesByMode: { m1: 0.5 } },
		};

		expect(tokensOf({ status: 200, meta: { variables, variableCollections: { c1: collection } } })).toEqual({
			light: { "color-brand": "#ff0066", primary: "#ff0066", "radius-card": "12px" },
			dark: { "color-brand": "#ff8099", primary: "#ff8099", "radius-card": "12px" },
		});
	});
});
