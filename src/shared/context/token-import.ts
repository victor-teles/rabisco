// Token files from other tools, read into names and CSS values: DTCG JSON (designtokens.org, Tokens Studio, Style
// Dictionary) and Figma Variables (the REST API's `variables/local` reply). DESIGN.md stays the source of truth.

import { isFiniteNumber, isString } from "../guards";
import { isJsonArray, isJsonObject, type Json, type JsonObject } from "../json";
import { formatTextStyle, type TextStyle } from "./tokens";

/** `path` is the token's group and name, `type` its DTCG type when the file says */
export type TokenEntry = { path: string[]; type: string | null; value: string; dark: boolean };

const MAX_ALIAS_DEPTH = 8;

const round = (n: number, places = 4) => Math.round(n * 10 ** places) / 10 ** places;

const channel = (value: Json | undefined) => (isFiniteNumber(value) ? value : 0);

function hexOf(r: number, g: number, b: number, a = 1) {
	const parts = a < 1 ? [r, g, b, a] : [r, g, b];

	return `#${parts
		.map((n) =>
			Math.round(Math.min(1, Math.max(0, n)) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}

/** DTCG 2025 colors: `{ colorSpace, components, alpha, hex }` */
function colorValue(value: JsonObject): string | null {
	const components = isJsonArray(value.components) ? value.components.map(channel) : null;
	const alpha = isFiniteNumber(value.alpha) ? value.alpha : 1;
	const slash = alpha < 1 ? ` / ${round(alpha)}` : "";

	if (!components || components.length !== 3) return isString(value.hex) ? value.hex : null;
	const x = round(components[0]!);
	const y = round(components[1]!);
	const z = round(components[2]!);

	switch (value.colorSpace) {
		case "srgb":
			return hexOf(components[0]!, components[1]!, components[2]!, alpha);
		case "oklch":
		case "oklab":
		case "lab":
		case "lch":
			return `${value.colorSpace}(${x} ${y} ${z}${slash})`;
		case "hsl":
		case "hwb":
			return `${value.colorSpace}(${x} ${y}% ${z}%${slash})`;
		default:
			return isString(value.hex) ? value.hex : null;
	}
}

/** `{ value: 16, unit: "px" }` or a bare number of px */
function dimensionValue(value: Json | undefined): string | null {
	if (isFiniteNumber(value)) return value === 0 ? "0" : `${round(value)}px`;

	if (isString(value)) return value;

	if (!isJsonObject(value) || !isFiniteNumber(value.value) || !isString(value.unit)) return null;

	return `${round(value.value)}${value.unit}`;
}

const familyName = (name: string) => (/^[a-z-]+$/i.test(name) ? name : `"${name.replace(/["\\]/g, "")}"`);

type Resolve = (value: Json | undefined, type: string | null) => string | null;

function shadowValue(value: Json | undefined, resolve: Resolve): string | null {
	const layers = isJsonArray(value) ? value : [value];

	const parts = layers.map((layer) => {
		if (!isJsonObject(layer)) return null;
		const lengths = [layer.offsetX, layer.offsetY, layer.blur, layer.spread].map((part) => resolve(part, "dimension"));
		const color = resolve(layer.color, "color");

		if (lengths.some((part) => part === null) || color === null) return null;

		return `${layer.inset === true ? "inset " : ""}${lengths.join(" ")} ${color}`;
	});

	return parts.every((part) => part !== null) ? parts.join(", ") : null;
}

const WEIGHT_NAMES = new Map(
	Object.entries({
		thin: "100",
		hairline: "100",
		"extra-light": "200",
		"ultra-light": "200",
		light: "300",
		normal: "400",
		regular: "400",
		book: "400",
		medium: "500",
		"semi-bold": "600",
		"demi-bold": "600",
		bold: "700",
		"extra-bold": "800",
		"ultra-bold": "800",
		black: "900",
		heavy: "900",
	}),
);

function weightValue(value: Json | undefined): string | null {
	if (isFiniteNumber(value)) return String(Math.round(value));

	if (!isString(value)) return null;

	const key = value
		.toLowerCase()
		.replace(/[\s_]+/g, "-")
		.replace(/(extra|ultra|semi|demi)(?=[a-z])/, "$1-");

	return WEIGHT_NAMES.get(key) ?? (/^\d+$/.test(value) ? value : null);
}

function typographyValue(value: Json | undefined, resolve: Resolve): string | null {
	if (!isJsonObject(value)) return null;
	const size = resolve(value.fontSize, "dimension");

	if (size === null) return null;
	const style: TextStyle = { size };
	const lineHeight = resolve(value.lineHeight, "number");
	const weight = resolve(value.fontWeight, "fontWeight");
	const tracking = resolve(value.letterSpacing, "dimension");

	if (lineHeight !== null) style.lineHeight = lineHeight;

	if (weight !== null) style.weight = weight;

	if (tracking !== null && tracking !== "0") style.tracking = tracking;

	return formatTextStyle(style);
}

/** A `$value` as CSS, with `{group.token}` references followed */
function cssValue(
	value: Json | undefined,
	type: string | null,
	lookup: (path: string) => Json | undefined,
	depth = 0,
): string | null {
	const resolve: Resolve = (part, partType) => cssValue(part, partType, lookup, depth + 1);
	const alias = isString(value) ? /^\{([^{}]+)\}$/.exec(value.trim())?.[1] : undefined;

	if (alias !== undefined) {
		const target = lookup(alias);
		const targetValue = isJsonObject(target) ? (target.$value ?? target.value) : target;

		return depth < MAX_ALIAS_DEPTH ? resolve(targetValue, type) : null;
	}

	switch (type) {
		case "color":
			return isJsonObject(value) ? colorValue(value) : isString(value) ? value : null;
		case "dimension":
			return dimensionValue(value);
		case "fontFamily":
			return isJsonArray(value) ? value.filter(isString).map(familyName).join(", ") : isString(value) ? value : null;
		case "fontWeight":
			return weightValue(value);
		case "shadow":
			return shadowValue(value, resolve);
		case "typography":
			return typographyValue(value, resolve);
		default:
			return isString(value) ? value : isFiniteNumber(value) ? String(value) : null;
	}
}

const typeOf = (value: JsonObject) => (isString(value.$type) ? value.$type : isString(value.type) ? value.type : null);

function walkDtcg(
	group: JsonObject,
	path: string[],
	inherited: string | null,
	visit: (path: string[], token: JsonObject, type: string | null) => void,
) {
	const type = typeOf(group) ?? inherited;

	for (const [key, entry] of Object.entries(group)) {
		if (key.startsWith("$")) continue;

		if (isString(entry) || isFiniteNumber(entry)) visit([...path, key], { $value: entry }, type);
		else if (isJsonObject(entry) && ("$value" in entry || ("value" in entry && !isJsonObject(entry.value)))) {
			visit([...path, key], entry, typeOf(entry) ?? type);
		} else if (isJsonObject(entry)) walkDtcg(entry, [...path, key], type, visit);
	}
}

const isModeName = (segment: string) => /^(?:light|dark)$/i.test(segment);

export function dtcgEntries(root: JsonObject): TokenEntry[] {
	const entries: TokenEntry[] = [];

	const lookup = (reference: string) =>
		reference.split(".").reduce<Json | undefined>((node, key) => (isJsonObject(node) ? node[key] : undefined), root);

	walkDtcg(root, [], null, (path, token, type) => {
		const value = cssValue(token.$value ?? token.value, type, lookup);

		if (value === null) return;
		entries.push({
			path: path.filter((segment) => !isModeName(segment)),
			type,
			value,
			dark: path.some((segment) => /^dark$/i.test(segment)),
		});
	});

	return entries;
}

type FigmaMode = { modeId: string; name: string };

type FigmaVariable = { name: string; type: string; collection: string; values: JsonObject };

const asRecordValues = (value: Json | undefined): Json[] =>
	isJsonArray(value)
		? [...value]
		: isJsonObject(value)
			? Object.values(value).filter((entry) => entry !== undefined)
			: [];

function figmaVariables(meta: JsonObject): Map<string, FigmaVariable> {
	const variables = new Map<string, FigmaVariable>();

	for (const entry of asRecordValues(meta.variables)) {
		if (!isJsonObject(entry) || !isString(entry.id) || !isString(entry.name) || !isJsonObject(entry.valuesByMode))
			continue;
		variables.set(entry.id, {
			name: entry.name,
			type: isString(entry.resolvedType) ? entry.resolvedType : "",
			collection: isString(entry.variableCollectionId) ? entry.variableCollectionId : "",
			values: entry.valuesByMode,
		});
	}

	return variables;
}

/** The mode for light values (the default) and the one named dark, per collection */
function figmaModes(meta: JsonObject): Map<string, { light: string | null; dark: string | null; names: FigmaMode[] }> {
	const modes = new Map<string, { light: string | null; dark: string | null; names: FigmaMode[] }>();

	for (const entry of asRecordValues(meta.variableCollections)) {
		if (!isJsonObject(entry) || !isString(entry.id)) continue;

		const names = asRecordValues(entry.modes).flatMap((mode) =>
			isJsonObject(mode) && isString(mode.modeId) && isString(mode.name)
				? [{ modeId: mode.modeId, name: mode.name }]
				: [],
		);

		const dark = names.find((mode) => /dark/i.test(mode.name))?.modeId ?? null;
		const fallback = names.find((mode) => mode.modeId !== dark)?.modeId ?? null;
		const light = isString(entry.defaultModeId) && entry.defaultModeId !== dark ? entry.defaultModeId : fallback;

		modes.set(entry.id, { light, dark, names });
	}

	return modes;
}

/** Figma floats have no unit or role; the name says which token they are */
function floatType(name: string): string | null {
	const words = name.toLowerCase();

	if (/weight/.test(words)) return "fontWeight";

	if (/radius|radii|corner|rounded|spacing|space|gap|padding|margin|font-?size|text/.test(words)) return "dimension";

	return null;
}

function figmaValue(
	variable: FigmaVariable,
	value: Json | undefined,
	variables: Map<string, FigmaVariable>,
	modeName: (variable: FigmaVariable) => string | undefined,
	depth = 0,
): string | null {
	if (isJsonObject(value) && value.type === "VARIABLE_ALIAS" && isString(value.id)) {
		const target = variables.get(value.id);

		if (!target || depth >= MAX_ALIAS_DEPTH) return null;
		const mode = modeName(target) ?? Object.keys(target.values)[0];

		return mode === undefined ? null : figmaValue(target, target.values[mode], variables, modeName, depth + 1);
	}

	switch (variable.type) {
		case "COLOR":
			return isJsonObject(value)
				? hexOf(channel(value.r), channel(value.g), channel(value.b), isFiniteNumber(value.a) ? value.a : 1)
				: null;
		case "FLOAT": {
			const type = floatType(variable.name);

			return type && isFiniteNumber(value) ? cssValue(value, type, () => undefined) : null;
		}

		case "STRING":
			return isString(value) && /font|family|typeface/i.test(variable.name) ? value : null;
		default:
			return null;
	}
}

const typeOfFigma = (variable: FigmaVariable) =>
	variable.type === "COLOR" ? "color" : variable.type === "FLOAT" ? floatType(variable.name) : "fontFamily";

/** `null` when the file isn't Figma's variables reply */
export function figmaEntries(root: JsonObject): TokenEntry[] | null {
	const meta = isJsonObject(root.meta) ? root.meta : root;

	if (!isJsonObject(meta.variables) && !isJsonArray(meta.variables)) return null;
	const variables = figmaVariables(meta);
	const modes = figmaModes(meta);
	const entries: TokenEntry[] = [];

	for (const variable of variables.values()) {
		const collection = modes.get(variable.collection);

		for (const dark of [false, true]) {
			const modeId = dark ? collection?.dark : (collection?.light ?? Object.keys(variable.values)[0]);

			if (!modeId || !(modeId in variable.values)) continue;
			const modeName = collection?.names.find((mode) => mode.modeId === modeId)?.name;

			const sameMode = (target: FigmaVariable) => {
				const targetModes = modes.get(target.collection);
				const match = targetModes?.names.find((mode) => mode.name === modeName)?.modeId;

				return match ?? (dark ? targetModes?.dark : targetModes?.light) ?? undefined;
			};

			const value = figmaValue(variable, variable.values[modeId], variables, sameMode);

			if (value !== null) entries.push({ path: variable.name.split("/"), type: typeOfFigma(variable), value, dark });
		}
	}

	return entries;
}
