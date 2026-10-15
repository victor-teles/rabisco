import { readImports } from "../jsx/imports";
import { resolveModule } from "../jsx/modules";
import { flatten, parseFile, type JsxElement } from "../jsx/tree";
import { literalOf } from "./scope";
import { matching, splitTop, tokenize, unquote, type Tok } from "./tokens";

// Reads and edits `cva` tables as text, so the file keeps its formatting.

export type VariantOption = {
	name: string;
	/** `null` when the value isn't a plain string */
	classes: string | null;
	/** The `key: value` entry, without its comma */
	start: number;
	end: number;
	value: { start: number; end: number; quote: string } | null;
};

export type VariantAxis = {
	name: string;
	options: VariantOption[];
	default?: string;
	/** The braces of the options object */
	open: number;
	close: number;
	multiline: boolean;
};

export type VariantTable = { name: string; axes: VariantAxis[] };

export type VariantUsage = {
	path: string;
	start: number;
	/** Axis to option; `null` when not set, `"*"` when set by an expression */
	values: Record<string, string | null>;
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const keyOf = (tok: Tok) => (tok.type === "string" ? unquote(tok.text) : tok.text);

const stringOf = (toks: Tok[]) => (toks.length === 1 && toks[0]!.type === "string" ? toks[0]! : null);

function entriesOf(toks: Tok[], open: number) {
	return splitTop(toks, open + 1, matching(toks, open), [","], false).flatMap((part) =>
		part[0] && part[1]?.text === ":" ? [{ key: part[0], value: part.slice(2), part }] : [],
	);
}

function axisOf(toks: Tok[], key: Tok, value: Tok[]): VariantAxis | null {
	const brace = value[0];

	if (value.length < 2 || brace?.type !== "{") return null;
	const open = toks.indexOf(brace);
	const close = matching(toks, open);

	const options = entriesOf(toks, open).map(({ key: option, value: classes, part }) => {
		const string = stringOf(classes);

		return {
			name: keyOf(option),
			classes: string ? unquote(string.text) : null,
			start: option.start,
			end: part[part.length - 1]!.end,
			value: string ? { start: string.start, end: string.end, quote: string.text[0]! } : null,
		};
	});

	return {
		name: keyOf(key),
		options,
		open: toks[open]!.start,
		close: toks[close]!.start,
		multiline: toks.slice(open + 1, close + 1).some((tok) => tok.nl),
	};
}

/** Every `const x = cva(base, { variants })` in the file */
export function variantTables(source: string): VariantTable[] {
	const toks = tokenize(source);

	if (!toks) return [];
	const tables: VariantTable[] = [];

	for (let i = 2; i < toks.length; i++) {
		if (toks[i]!.text !== "cva" || toks[i + 1]?.type !== "(" || toks[i - 1]!.text !== "=") continue;
		const close = matching(toks, i + 1);
		const config = splitTop(toks, i + 2, close, [","], false)[1];

		if (config?.[0]?.type !== "{") continue;
		const configOpen = toks.indexOf(config[0]);
		const entries = entriesOf(toks, configOpen);
		const variants = entries.find((entry) => keyOf(entry.key) === "variants");
		const defaults = entries.find((entry) => keyOf(entry.key) === "defaultVariants");
		const axes: VariantAxis[] = [];

		if (variants?.value[0]?.type === "{") {
			for (const { key, value } of entriesOf(toks, toks.indexOf(variants.value[0]))) {
				const axis = axisOf(toks, key, value);

				if (axis) axes.push(axis);
			}
		}

		if (defaults?.value[0]?.type === "{") {
			for (const { key, value } of entriesOf(toks, toks.indexOf(defaults.value[0]))) {
				const axis = axes.find((a) => a.name === keyOf(key));
				const literal = literalOf(value);

				if (axis && literal !== undefined) axis.default = String(literal);
			}
		}

		tables.push({ name: toks[i - 2]!.text, axes });
		i = close;
	}

	return tables;
}

/** The table whose axes are the component's variants */
export function tableFor(source: string, axes: string[]): VariantTable | null {
	const key = [...axes].sort().join("\0");

	return (
		variantTables(source).find(
			(table) =>
				table.axes
					.map((axis) => axis.name)
					.sort()
					.join("\0") === key,
		) ?? null
	);
}

function findAxis(source: string, table: string, axis: string) {
	return variantTables(source)
		.find((t) => t.name === table)
		?.axes.find((a) => a.name === axis);
}

const cleanClasses = (classes: string) =>
	classes
		.replace(/["'`\\]/g, "")
		.replace(/\s+/g, " ")
		.trim();

/** `Extra large` → `extra-large`; empty when nothing is left */
export const optionName = (name: string) =>
	name
		.trim()
		.toLowerCase()
		.replace(/[^\w-]+/g, "-")
		.replace(/^-+|-+$/g, "");

export function optionError(axis: VariantAxis, name: string): string | null {
	const clean = optionName(name);

	if (!clean) return "Name the option";

	if (axis.options.some((option) => option.name === clean)) return `${axis.name} already has ${clean}`;

	return null;
}

export function setVariantClasses(source: string, table: string, axis: string, option: string, classes: string) {
	const found = findAxis(source, table, axis)?.options.find((o) => o.name === option);

	if (!found?.value) return null;
	const { start, end, quote } = found.value;

	return `${source.slice(0, start)}${quote}${cleanClasses(classes)}${quote}${source.slice(end)}`;
}

function lineIndent(source: string, offset: number) {
	const lineStart = source.lastIndexOf("\n", offset - 1) + 1;

	return /^[\t ]*/.exec(source.slice(lineStart))![0];
}

export function addVariantOption(source: string, table: string, axis: string, name: string, classes: string) {
	const found = findAxis(source, table, axis);

	if (!found || optionError(found, name)) return null;
	const clean = optionName(name);
	const quote = found.options.find((o) => o.value)?.value?.quote ?? '"';
	const entry = `${IDENTIFIER.test(clean) ? clean : JSON.stringify(clean)}: ${quote}${cleanClasses(classes)}${quote}`;
	const last = found.options.at(-1);

	if (!last) return `${source.slice(0, found.open)}{ ${entry} }${source.slice(found.close + 1)}`;
	const comma = /^\s*,/.exec(source.slice(last.end, found.close));
	const after = comma ? last.end + comma[0].length : last.end;

	const text = found.multiline
		? `${comma ? "" : ","}\n${lineIndent(source, last.start)}${entry}${comma ? "," : ""}`
		: comma
			? ` ${entry},`
			: `, ${entry}`;

	return source.slice(0, after) + text + source.slice(after);
}

/** Refuses the default option */
export function removeVariantOption(source: string, table: string, axis: string, option: string) {
	const found = findAxis(source, table, axis);
	const index = found?.options.findIndex((o) => o.name === option) ?? -1;

	if (!found || index < 0 || found.default === option) return null;
	const entry = found.options[index]!;
	const comma = /^\s*,/.exec(source.slice(entry.end, found.close));
	let start = entry.start;
	let end = comma ? entry.end + comma[0].length : entry.end;

	if (found.multiline) {
		start = source.lastIndexOf("\n", entry.start - 1);
	} else if (!comma && index > 0) {
		start = found.options[index - 1]!.end;
	} else if (comma) {
		end += /^\s*/.exec(source.slice(end))![0].length;
	}

	return source.slice(0, start) + source.slice(end);
}

function attributeValue(element: JsxElement, name: string): string | null {
	const attribute = element.attributes.find((a) => a.kind === "attribute" && a.name === name);

	if (!attribute || attribute.kind !== "attribute") return null;
	const { value } = attribute;

	if (!value) return "true";

	if (value.kind === "string") return value.value;
	const literal = /^\s*(["'`])([^"'`$]*)\1\s*$|^\s*(true|false)\s*$/.exec(value.text);

	return literal ? (literal[2] ?? literal[3]!) : "*";
}

/** Every `<Name>` the project writes, in file order */
export function componentElements(files: Record<string, string>, componentPath: string, exportName: string) {
	const target = componentPath.replace(/\.tsx?$/, "");
	const found: { path: string; source: string; element: JsxElement }[] = [];

	for (const path of Object.keys(files).sort()) {
		if (path === componentPath || !/\.(tsx|jsx)$/.test(path)) continue;
		const source = files[path]!;

		if (!source.includes(exportName)) continue;
		const parsed = parseFile(source);
		const locals = new Set<string>();

		for (const decl of readImports(parsed)) {
			if (resolveModule(path, decl.module) !== target) continue;

			for (const specifier of decl.named) if (specifier.imported === exportName) locals.add(specifier.local);
		}

		if (!locals.size) continue;

		for (const element of flatten(parsed.roots))
			if (element.name && locals.has(element.name)) found.push({ path, source, element });
	}

	return found;
}

/** Every `<Name>` the project writes, with the options it picks */
export function variantUsages(
	files: Record<string, string>,
	componentPath: string,
	exportName: string,
	axes: string[],
): VariantUsage[] {
	return componentElements(files, componentPath, exportName).map(({ path, element }) => {
		const values: Record<string, string | null> = {};

		for (const axis of axes) values[axis] = attributeValue(element, axis);

		return { path, start: element.start, values };
	});
}

/** Option to count; a usage that leaves the axis unset counts for the default */
export function optionCounts(usages: VariantUsage[], axis: string, fallback: string | undefined) {
	const counts = new Map<string, number>();

	for (const usage of usages) {
		const option = usage.values[axis] ?? fallback;

		if (option) counts.set(option, (counts.get(option) ?? 0) + 1);
	}

	return counts;
}
