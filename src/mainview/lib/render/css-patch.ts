function splitBlocks(css: string): string[] | null {
	const blocks: string[] = [];
	let depth = 0;
	let start = 0;
	let quote = "";

	const push = (end: number) => {
		const block = css.slice(start, end).trim();

		if (block) blocks.push(block);
		start = end;
	};

	for (let i = 0; i < css.length; i++) {
		const char = css[i];

		if (quote) {
			if (char === "\\") i++;
			else if (char === quote) quote = "";

			continue;
		}

		if (char === '"' || char === "'") quote = char;
		else if (char === "/" && css[i + 1] === "*") {
			const end = css.indexOf("*/", i + 2);

			if (end === -1) return null;
			i = end + 1;
		} else if (char === "{") depth++;
		else if (char === "}") {
			if (--depth < 0) return null;

			if (depth === 0) push(i + 1);
		} else if (char === ";" && depth === 0) push(i + 1);
	}

	if (depth !== 0 || quote) return null;
	push(css.length);

	return blocks;
}

function preludeOf(block: string) {
	const brace = block.indexOf("{");

	return (brace === -1 ? block : block.slice(0, brace)).trim();
}

function bodyOf(block: string) {
	return block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
}

type Keyed = { prelude: string; block: string };

/** Keyed by prelude and occurrence, since Tailwind emits more than one `@layer base` */
function keyed(blocks: string[]): Map<string, Keyed> {
	const byKey = new Map<string, Keyed>();
	const seen = new Map<string, number>();

	for (const block of blocks) {
		const prelude = preludeOf(block);
		const count = seen.get(prelude) ?? 0;

		seen.set(prelude, count + 1);
		byKey.set(`${count} ${prelude}`, { prelude, block });
	}

	return byKey;
}

const DECLARATION = /(?:^|[\s;{])(-?-?[a-z][\w-]*)\s*:/gi;

/** Shorthands and their longhands share a family, so a later `pl-2` still counts as overriding a new `px-12` */
const FAMILIES = new Map([
	["top", "inset"],
	["right", "inset"],
	["bottom", "inset"],
	["left", "inset"],
	["row", "gap"],
	["column", "gap"],
	["columns", "gap"],
	["place", "align"],
	["justify", "align"],
	["line", "font"],
	["white", "text"],
	["width", "size"],
	["height", "size"],
	["min", "size"],
	["max", "size"],
	["inline", "size"],
	["block", "size"],
]);

const SIDES = new Set(["top", "right", "bottom", "left", "inline", "block", "start", "end"]);

const BORDER_PARTS = ["border-width", "border-style", "border-color"];

const BACKGROUND_PARTS = ["color", "image", "position", "size", "repeat", "attachment", "origin", "clip"];

function addFamilies(families: Set<string>, property: string) {
	if (property.startsWith("--")) {
		families.add(property);

		return;
	}

	const parts = property
		.replace(/^-[a-z]+-/i, "")
		.toLowerCase()
		.split("-");

	const head = parts[0]!;
	const last = parts.at(-1)!;

	if (head === "border" && (parts.length === 1 || SIDES.has(last))) {
		for (const part of BORDER_PARTS) families.add(part);
	} else if (head === "border") {
		families.add(`border-${last}`);
	} else if (head === "background" && parts.length === 1) {
		for (const part of BACKGROUND_PARTS) families.add(`background-${part}`);
	} else if (head === "background") {
		families.add(`background-${parts[1]}`);
	} else {
		families.add(FAMILIES.get(head) ?? head);
	}
}

const PSEUDO_ELEMENT = /::([\w-]+)/g;

/**
 * Rules for different pseudo-elements never override each other, so each one gets its own families. A rule whose
 * selector names none counts for the element too, since nested rules and grouped `@media` blocks can target both.
 */
function familiesOf(rule: string): Set<string> {
	const properties = new Set<string>();

	for (const [, property] of rule.matchAll(DECLARATION)) addFamilies(properties, property!);
	const pseudos = new Set<string>();

	for (const [, pseudo] of rule.matchAll(PSEUDO_ELEMENT)) pseudos.add(pseudo!);

	if (!/::[\w-]/.test(preludeOf(rule))) pseudos.add("");
	const families = new Set<string>();

	for (const pseudo of pseudos) {
		for (const family of properties) families.add(family === "all" ? "all" : `${pseudo}:${family}`);
	}

	return families;
}

function overlaps(families: Set<string>, other: Set<string>) {
	for (const family of other) if (families.has(family)) return true;

	return false;
}

/**
 * The rules of `next` that `sent` lacks, plus every later rule that sets a property in the same family, so appending
 * them keeps the order Tailwind gave them. Null when `next` dropped a rule that no new rule replaces.
 */
function changedRules(sent: string[], next: string[]): string[] | null {
	const sentSet = new Set(sent);
	const nextSet = new Set(next);
	const fresh = new Set(next.filter((rule) => !sentSet.has(rule)));
	const freshPreludes = new Set(Array.from(fresh, preludeOf));

	for (const rule of sent) if (!nextSet.has(rule) && !freshPreludes.has(preludeOf(rule))) return null;
	const families = new Set<string>();
	const rules: string[] = [];

	for (const rule of next) {
		if (families.size === 0 && !fresh.has(rule)) continue;
		const ruleFamilies = familiesOf(rule);

		const included =
			fresh.has(rule) || families.has("all") || ruleFamilies.has("all") || overlaps(families, ruleFamilies);

		if (!included) continue;
		rules.push(rule);

		for (const family of ruleFamilies) families.add(family);
	}

	return rules;
}

/** Tailwind groups neighbouring rules under one `@media`; each one is its own rule here so a patch can take just one */
function rulesOf(layer: string): string[] | null {
	const blocks = splitBlocks(bodyOf(layer));

	if (!blocks) return null;
	const rules: string[] = [];

	for (const block of blocks) {
		const prelude = preludeOf(block);
		const inner = prelude.startsWith("@media") ? splitBlocks(bodyOf(block)) : null;

		if (!inner) {
			rules.push(block);
			continue;
		}

		for (const rule of inner) rules.push(`${prelude} {\n${rule}\n}`);
	}

	return rules;
}

type Sheet = { blocks: Map<string, Keyed>; rules: Map<string, string[] | null> };

/** The last two sheets, since the CSS a patch is built on is the one the previous patch was built for */
const parsed = new Map<string, Sheet>();

function parse(css: string): Sheet | null {
	const cached = parsed.get(css);

	if (cached) return cached;
	const blocks = splitBlocks(css);

	if (!blocks) return null;
	const sheet = { blocks: keyed(blocks), rules: new Map<string, string[] | null>() };

	parsed.set(css, sheet);

	for (const key of parsed.keys()) if (parsed.size > 2) parsed.delete(key);

	return sheet;
}

function layerRules(sheet: Sheet, key: string, layer: string) {
	let rules = sheet.rules.get(key);

	if (rules === undefined) sheet.rules.set(key, (rules = rulesOf(layer)));

	return rules;
}

/**
 * Utilities is the last layer, so its rules can leave it: WebKit adds an unlayered sheet to its rule set, while a
 * layered one rebuilds the set. Not with `!important`, which layers order the other way round.
 */
function layered(prelude: string, rules: string[]) {
	if (prelude === "@layer utilities" && !rules.some((rule) => rule.includes("!important"))) return rules.join("\n");

	return `${prelude} {\n${rules.join("\n")}\n}`;
}

/**
 * CSS that, inserted after `sent`, styles like `next`: new and changed top-level blocks, and in a changed `@layer`
 * its new rules with the later rules they could override, so a new `px-12` cannot beat an older `md:px-4`. Null when
 * `next` drops something `sent` has, so only a full replace is correct.
 */
export function cssPatch(sent: string, next: string): string | null {
	const sentSheet = parse(sent);
	const nextSheet = parse(next);

	if (!sentSheet || !nextSheet) return null;

	for (const key of sentSheet.blocks.keys()) if (!nextSheet.blocks.has(key)) return null;
	const patch: string[] = [];

	for (const [key, { prelude, block }] of nextSheet.blocks) {
		const before = sentSheet.blocks.get(key)?.block;

		if (before === block) continue;

		if (before === undefined || !prelude.startsWith("@layer")) {
			patch.push(block);
			continue;
		}

		const sentRules = layerRules(sentSheet, key, before);
		const nextRules = layerRules(nextSheet, key, block);
		const rules = sentRules && nextRules ? changedRules(sentRules, nextRules) : null;

		if (!rules) return null;
		patch.push(layered(prelude, rules));
	}

	return patch.join("\n");
}
