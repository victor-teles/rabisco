import { literalOf, scanScope, skipAngles, type Scope, type Variants } from "./scope";
import { isOpen, matching, splitTop, textOf, tokenize, unquote, type Tok } from "./tokens";

/**
 * The public API of a project component file: its exported components, their
 * props (with defaults), cva variants, children and the element they extend.
 * Read from the source without running it; never throws.
 */

export type PropType =
	| { kind: "string" }
	| { kind: "number" }
	| { kind: "boolean" }
	| { kind: "enum"; options: string[] }
	| { kind: "node" }
	/** `text` is the type as written, e.g. `(id: string) => void` */
	| { kind: "function"; text: string }
	| { kind: "other"; text: string };

export type PropSpec = {
	name: string;
	type: PropType;
	optional: boolean;
	/** The destructuring default (or cva default variant), when it is a literal */
	default?: string | number | boolean;
};

export type ComponentExport = {
	name: string;
	props: PropSpec[];
	/** cva variant axes from `VariantProps<typeof x>`, with their options and default */
	variants: Variants;
	acceptsChildren: boolean;
	/** `"button"` for `ComponentProps<"button">`/`ButtonHTMLAttributes`; the referenced name for `ComponentProps<typeof X>` */
	extendsElement?: string;
};

export type ComponentApi = { exports: ComponentExport[] };

type Member = { name: string; optional: boolean; type: Tok[]; method?: boolean };

type Resolved = { members: Member[]; variants: Variants; extendsElement?: string };

const VOID_ELEMENTS = new Set([
	"input",
	"img",
	"br",
	"hr",
	"area",
	"base",
	"col",
	"embed",
	"link",
	"meta",
	"source",
	"track",
	"wbr",
	"textarea",
]);

const ELEMENT_NAMES = new Map(
	Object.entries({
		Anchor: "a",
		Paragraph: "p",
		Heading: "h2",
		Image: "img",
		UList: "ul",
		OList: "ol",
		LI: "li",
		TableRow: "tr",
		TableCell: "td",
		"": "div",
	}),
);

const CONTINUES = new Set(["|", "&", ":", "=>", "?", "<", ",", "(", "=", "."]);

/** Members of a type literal body (between its braces): `;`, `,` or line separated. */
function membersOf(body: Tok[]): Member[] {
	const parts: Tok[][] = [];
	let current: Tok[] = [];

	for (let i = 0; i < body.length; i++) {
		const tok = body[i]!;

		const startsMember =
			tok.nl &&
			current.length &&
			(tok.type === "name" || tok.type === "string") &&
			!CONTINUES.has(current[current.length - 1]!.text) &&
			[":", "?", "("].includes(body[i + 1]?.text ?? "");

		if (tok.text === ";" || tok.text === "," || startsMember) {
			if (current.length) parts.push(current);
			current = [];

			if (!startsMember) continue;
		}

		if (isOpen(tok)) {
			const end = matching(body, i);
			current.push(...body.slice(i, end + 1));
			i = end;
		} else current.push(tok);
	}

	if (current.length) parts.push(current);

	const members: Member[] = [];

	for (let part of parts) {
		if (part[0]?.text === "readonly") part = part.slice(1);
		const key = part[0];

		if (!key || (key.type !== "name" && key.type !== "string" && !/^[a-z]/i.test(key.text))) continue;
		let k = 1;
		const optional = part[k]?.text === "?";

		if (optional) k++;
		const name = key.type === "string" ? unquote(key.text) : key.text;

		if (part[k]?.text === ":") members.push({ name, optional, type: part.slice(k + 1) });
		else if (part[k]?.type === "(" || part[k]?.text === "<")
			members.push({ name, optional, type: part.slice(k), method: true });
	}

	return members;
}

const wrapped = (toks: Tok[]) => toks[0]?.type === "(" && matching(toks, 0) === toks.length - 1;

/** Generic arguments of `Name<…>` (the tokens after the head), split at top-level commas. */
function typeArgs(toks: Tok[]): Tok[][] {
	const at = toks.findIndex((t) => t.text === "<");

	return at === -1 ? [] : splitTop(toks, at + 1, skipAngles(toks, at) - 1, [","]);
}

const stringLiterals = (toks: Tok[]) => toks.flatMap((t) => (t.type === "string" ? [unquote(t.text)] : []));

/** Resolves a props type (an intersection of literals, aliases, interfaces and React helpers) to its members. */
function resolve(scope: Scope, toks: Tok[], seen: Set<string> = new Set()): Resolved {
	const out: Resolved = { members: [], variants: {} };

	const merge = (inner: Resolved) => {
		for (const member of inner.members) if (!out.members.some((m) => m.name === member.name)) out.members.push(member);
		Object.assign(out.variants, inner.variants);
		out.extendsElement ??= inner.extendsElement;
	};

	for (const part of splitTop(toks, 0, toks.length, ["&"])) {
		if (wrapped(part)) {
			merge(resolve(scope, part.slice(1, -1), seen));
			continue;
		}

		if (part[0]?.type === "{") {
			merge({ members: membersOf(part.slice(1, matching(part, 0))), variants: {} });
			continue;
		}

		const text = textOf(scope.source, part);

		const head = text
			.replace(/<.*$/s, "")
			.replace(/^React\./, "")
			.trim();

		const args = typeArgs(part);
		let match: RegExpExecArray | null;

		if (/^ComponentProps(?:WithoutRef|WithRef)?$/.test(head)) {
			const arg = textOf(scope.source, args[0] ?? []);
			out.extendsElement ??= /^["']/.test(arg) ? unquote(arg) : arg.replace(/^typeof\s+/, "");
		} else if ((match = /^(\w*)HTMLAttributes$/.exec(head))) {
			const element = /^HTML(\w*)Element$/.exec(textOf(scope.source, args[0] ?? []))?.[1];
			out.extendsElement ??=
				element !== undefined
					? (ELEMENT_NAMES.get(element) ?? element.toLowerCase())
					: match[1]!.toLowerCase() || "div";
		} else if (head === "VariantProps") {
			const name = textOf(scope.source, args[0] ?? []).replace(/^typeof\s+/, "");
			Object.assign(out.variants, scope.cva.get(name) ?? {});
		} else if (head === "PropsWithChildren") {
			merge({ members: [{ name: "children", optional: true, type: [] }], variants: {} });

			if (args[0]) merge(resolve(scope, args[0], seen));
		} else if (head === "Omit" || head === "Pick" || head === "Partial" || head === "Readonly" || head === "Required") {
			const inner = resolve(scope, args[0] ?? [], seen);
			const keys = new Set(stringLiterals(args[1] ?? []));

			if (head === "Omit") inner.members = inner.members.filter((m) => !keys.has(m.name));

			if (head === "Pick") inner.members = inner.members.filter((m) => keys.has(m.name));

			if (head === "Partial" || head === "Required")
				inner.members = inner.members.map((m) => ({ ...m, optional: head === "Partial" }));
			merge(inner);
		} else if (part[0]?.type === "name" && (part.length === 1 || part[1]?.text === "<") && !seen.has(head)) {
			const next = new Set(seen).add(head);
			const alias = scope.types.get(head);
			const iface = scope.interfaces.get(head);

			if (alias) merge(resolve(scope, alias, next));

			if (iface) {
				merge({ members: membersOf(iface.body), variants: {} });

				for (const clause of iface.heritage) merge(resolve(scope, clause, next));
			}
		}
	}

	return out;
}

const NODE = /^(?:React\.)?(?:ReactNode|ReactElement(?:<.*>)?|JSX\.Element)$/;

const HANDLER = /^(?:React\.)?(?:\w*Handler(?:<.*>)?|Function|VoidFunction)$/;

/** Whether `toks` has a top-level `=>` (a function type). */
const isArrowType = (toks: Tok[]) => {
	for (let i = 0; i < toks.length; i++) {
		if (isOpen(toks[i])) i = matching(toks, i);
		else if (toks[i]!.text === "=>") return true;
	}

	return false;
};

function classify(scope: Scope, member: Member, depth = 0): PropType {
	const text = textOf(scope.source, member.type).replace(/^[|&]\s*/, "");

	if (member.method) return { kind: "function", text: `${text.replace(/\)\s*:\s*/, ") => ")}` };

	if (member.name === "children" && !member.type.length) return { kind: "node" };

	const union = splitTop(member.type, 0, member.type.length, ["|"])
		.map((part) => (wrapped(part) ? part.slice(1, -1) : part))
		.filter((part) => !["undefined", "null"].includes(textOf(scope.source, part)));

	const texts = union.map((part) => textOf(scope.source, part));

	if (!union.length) return { kind: "other", text };

	if (union.every((part) => part.length === 1 && part[0]!.type === "string"))
		return { kind: "enum", options: union.map((part) => unquote(part[0]!.text)) };

	if (texts.every((t) => t === "true" || t === "false" || t === "boolean")) return { kind: "boolean" };

	if (
		texts.includes("string") &&
		union.every((part, i) => texts[i] === "string" || (part.length === 1 && part[0]!.type === "string"))
	)
		return { kind: "string" };

	const [only] = texts;

	if (union.length === 1 && only !== undefined) {
		if (only === "string") return { kind: "string" };

		if (only === "number") return { kind: "number" };

		if (NODE.test(only)) return { kind: "node" };

		if (isArrowType(union[0]!) || HANDLER.test(only)) return { kind: "function", text: only };
		const alias = scope.types.get(only);

		if (alias && depth < 5) {
			const inner = classify(scope, { ...member, type: alias }, depth + 1);

			return inner.kind === "other" ? { kind: "other", text } : inner;
		}
	}

	return { kind: "other", text };
}

type Destructured = { names: string[]; defaults: Map<string, string | number | boolean> };

/** `{ a, b = "x", icon: Icon, ...rest }` → names and literal defaults. */
function destructure(param: Tok[]): Destructured {
	const out: Destructured = { names: [], defaults: new Map() };

	if (param[0]?.type !== "{") return out;

	for (const entry of splitTop(param, 1, matching(param, 0), [","], false)) {
		const key = entry[0];

		if (!key || key.text === "...") continue;
		const name = key.type === "string" ? unquote(key.text) : key.text;
		out.names.push(name);
		const eq = splitTop(entry, 0, entry.length, ["="], false);
		const value = eq.length > 1 ? literalOf(eq[eq.length - 1]!) : undefined;

		if (value !== undefined) out.defaults.set(name, value);
	}

	return out;
}

/** The type annotation of a parameter (`{ … }: T = {}` or `props?: T`). */
function paramType(param: Tok[]): Tok[] | undefined {
	let k = param[0]?.type === "{" ? matching(param, 0) + 1 : 1;

	if (param[k]?.text === "?") k++;

	if (param[k]?.text !== ":") return undefined;

	return splitTop(param, k + 1, param.length, ["="], false)[0];
}

function variantProp(name: string, variant: Variants[string], fallback?: string | number | boolean): PropSpec {
	const boolean = variant.options.length > 0 && variant.options.every((o) => o === "true" || o === "false");
	const raw = fallback ?? variant.default;
	const value = boolean && raw !== undefined ? raw === true || raw === "true" : raw;

	return withDefault(
		{ name, type: boolean ? { kind: "boolean" } : { kind: "enum", options: variant.options }, optional: true },
		value,
	);
}

/** Sets `default` only when there is one: specs without a default have no such key. */
function withDefault(spec: PropSpec, value: PropSpec["default"]): PropSpec {
	if (value !== undefined) spec.default = value;

	return spec;
}

function exportOf(scope: Scope, name: string, local: string): ComponentExport | null {
	const fn = scope.functions.get(local);

	if (!fn || !/^[A-Z]/.test(name)) return null;
	const param = fn.param ?? [];
	const annotation = paramType(param) ?? fn.typeArg;
	const { names, defaults } = destructure(param);
	const resolved: Resolved = annotation ? resolve(scope, annotation) : { members: [], variants: {} };

	const props: PropSpec[] = resolved.members.map((member) => {
		const value = defaults.get(member.name);

		return withDefault({ name: member.name, type: classify(scope, member), optional: member.optional }, value);
	});

	for (const [axis, variant] of Object.entries(resolved.variants)) {
		if (!props.some((p) => p.name === axis)) props.push(variantProp(axis, variant, defaults.get(axis)));
	}

	if (!annotation) {
		for (const prop of names) {
			const value = defaults.get(prop);
			props.push(
				withDefault(
					{
						name: prop,
						type: prop === "children" ? { kind: "node" } : { kind: "other", text: "unknown" },
						optional: value !== undefined,
					},
					value,
				),
			);
		}
	}

	const element = resolved.extendsElement;

	const api: ComponentExport = {
		name,
		props,
		variants: resolved.variants,
		acceptsChildren: props.some((p) => p.name === "children") || (!!element && !VOID_ELEMENTS.has(element)),
	};

	if (element) api.extendsElement = element;

	return api;
}

/** The exported components of a component file (PascalCase, function-like named exports). */
export function componentApi(_path: string, source: string): ComponentApi {
	try {
		const toks = tokenize(source);

		if (!toks) return { exports: [] };
		const scope = scanScope(source, toks);
		const exports: ComponentExport[] = [];

		for (const { local, name } of scope.exports) {
			const exp = exportOf(scope, name, local);

			if (exp && !exports.some((e) => e.name === name)) exports.push(exp);
		}

		return { exports };
	} catch {
		return { exports: [] };
	}
}

function typeText(type: PropType): string {
	switch (type.kind) {
		case "enum":
			return type.options.map((o) => JSON.stringify(o)).join(" | ");
		case "node":
			return "ReactNode";
		case "function":
		case "other":
			return type.text;
		default:
			return type.kind;
	}
}

/** One-line TS-ish signature for prompts: `StatCard({ label: string; tone?: "default" | "success" = "default" })`. */
export function propsSignature(exp: ComponentExport): string {
	const props = exp.props.map(
		(p) =>
			`${p.name}${p.optional ? "?" : ""}: ${typeText(p.type)}${p.default !== undefined ? ` = ${JSON.stringify(p.default)}` : ""}`,
	);

	const element = exp.extendsElement;

	if (element)
		props.push(
			`...props: ComponentProps<${/^[a-z][a-z0-9-]*$/.test(element) ? JSON.stringify(element) : `typeof ${element}`}>`,
		);

	return props.length ? `${exp.name}({ ${props.join("; ")} })` : `${exp.name}()`;
}
