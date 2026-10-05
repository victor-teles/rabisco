import { angleDelta, isOpen, matching, splitTop, unquote, type Tok } from "./tokens";

/**
 * The top-level declarations of a TSX file that matter for its component API:
 * type aliases, interfaces, cva variant tables, function-like values and the
 * export list. Built from tokens, so it never evaluates or compiles anything.
 */

export type Variants = Record<string, { options: string[]; default?: string }>;

export type FunctionInfo = {
	/** Tokens of the first parameter (`{ a, b = 1 }: Props`), if any */
	param?: Tok[];
	/** Props type given outside the parameter: `forwardRef<El, Props>`, `const X: FC<Props>` */
	typeArg?: Tok[];
};

export type Scope = {
	source: string;
	/** `type Name = …`: the tokens after `=` */
	types: Map<string, Tok[]>;
	/** `interface Name extends A, B { … }`: heritage clauses and the body inside the braces */
	interfaces: Map<string, { heritage: Tok[][]; body: Tok[] }>;
	/** `const x = cva(base, { variants, defaultVariants })` */
	cva: Map<string, Variants>;
	functions: Map<string, FunctionInfo>;
	/** Named exports in order: local binding → exported name */
	exports: { local: string; name: string }[];
};

/** Words that start a new top-level statement; a type alias without `;` ends before one on a new line. */
const STATEMENT = new Set(["export", "import", "const", "let", "var", "function", "type", "interface", "class", "enum", "declare", "async"]);
const WRAPPERS = new Set(["forwardRef", "memo"]);

/** Index after the `<…>` group that starts at `from`. */
export function skipAngles(toks: Tok[], from: number): number {
	let depth = 0;
	for (let i = from; i < toks.length; i++) {
		if (isOpen(toks[i])) {
			i = matching(toks, i);
			continue;
		}
		depth += angleDelta(toks[i]!);
		if (depth <= 0) return i + 1;
	}
	return toks.length;
}

/** End (exclusive) of a type that starts at `from`: a top-level `;`, a `stop` token, or a statement on a new line. */
function typeEnd(toks: Tok[], from: number, stop: string[] = []): number {
	for (let i = from; i < toks.length; i++) {
		const tok = toks[i]!;
		if (isOpen(tok)) {
			i = matching(toks, i);
			continue;
		}
		if (tok.text === ";" || stop.includes(tok.text)) return i;
		if (i > from && tok.nl && STATEMENT.has(tok.text)) return i;
	}
	return toks.length;
}

/** `{ key: value, … }` starting at `toks[0]`: entries with a simple key. */
export function objectEntries(toks: Tok[]): { key: string; value: Tok[] }[] {
	if (toks[0]?.type !== "{") return [];
	const close = matching(toks, 0);
	const entries: { key: string; value: Tok[] }[] = [];
	for (const part of splitTop(toks, 1, close, [","], false)) {
		const [key, colon] = part;
		if (!key || colon?.text !== ":") continue;
		entries.push({ key: key.type === "string" ? unquote(key.text) : key.text, value: part.slice(2) });
	}
	return entries;
}

/** A literal value as written: `"x"` → x, `true`, `3`, `-1`. */
export function literalOf(toks: Tok[]): string | number | boolean | undefined {
	if (toks.length === 1) {
		const [tok] = toks;
		if (tok!.type === "string") return unquote(tok!.text);
		if (tok!.type === "num") return Number(tok!.text);
		if (tok!.text === "true" || tok!.text === "false") return tok!.text === "true";
		if (tok!.type === "template" || tok!.type === "`") return undefined;
	}
	if (toks.length === 2 && toks[0]!.text === "-" && toks[1]!.type === "num") return -Number(toks[1]!.text);
	if (toks.length === 3 && toks[0]!.type === "`" && toks[2]!.type === "`") return toks[1]!.text;
	return undefined;
}

function cvaVariants(args: Tok[][]): Variants {
	const variants: Variants = {};
	const config = objectEntries(args[1] ?? []);
	for (const axis of objectEntries(config.find((e) => e.key === "variants")?.value ?? [])) {
		variants[axis.key] = { options: objectEntries(axis.value).map((option) => option.key) };
	}
	for (const { key, value } of objectEntries(config.find((e) => e.key === "defaultVariants")?.value ?? [])) {
		const literal = literalOf(value);
		if (variants[key] && literal !== undefined) variants[key]!.default = String(literal);
	}
	return variants;
}

/** First parameter of the parameter list whose `(` is at `open`. */
function firstParam(toks: Tok[], open: number): Tok[] | undefined {
	return splitTop(toks, open + 1, matching(toks, open), [","])[0];
}

/** `function Name<T>(…)` at `at` (the `function` token). */
function functionAt(toks: Tok[], at: number): FunctionInfo | null {
	let k = at + 1;
	if (toks[k]?.text === "*") k++;
	if (toks[k]?.type === "name") k++;
	if (toks[k]?.text === "<") k = skipAngles(toks, k);
	return toks[k]?.type === "(" ? { param: firstParam(toks, k) } : null;
}

/**
 * The component behind an initializer at `at`: an arrow, a function
 * expression, or one wrapped in `forwardRef`/`memo` (with `React.` or not).
 */
function functionFromInit(toks: Tok[], at: number): FunctionInfo | null {
	let k = at;
	if (toks[k]?.text === "async") k++;
	const tok = toks[k];
	if (!tok) return null;
	if (tok.text === "function") return functionAt(toks, k);
	if (tok.text === "<") k = skipAngles(toks, k);
	if (toks[k]?.type === "(") {
		const close = matching(toks, k);
		const after = toks[close + 1]?.text;
		return after === "=>" || after === ":" ? { param: firstParam(toks, k) } : null;
	}
	if (tok.type === "name" && toks[k + 1]?.text === "=>") return { param: [tok] };
	// Wrapper call: [React.]forwardRef<El, Props>(inner)
	let name = tok.text;
	while (toks[k + 1]?.text === "." && toks[k + 2]?.type === "name") {
		k += 2;
		name = toks[k]!.text;
	}
	if (!WRAPPERS.has(name)) return null;
	k++;
	let typeArg: Tok[] | undefined;
	if (toks[k]?.text === "<") {
		const end = skipAngles(toks, k);
		if (name === "forwardRef") typeArg = splitTop(toks, k + 1, end - 1, [","])[1];
		k = end;
	}
	if (toks[k]?.type !== "(") return null;
	const inner = functionFromInit(toks, k + 1);
	if (inner && typeArg && !inner.typeArg) inner.typeArg = typeArg;
	return inner;
}

/** `FC<Props>` / `React.FunctionComponent<Props>` annotation → `Props`. */
function fcTypeArg(annotation: Tok[]): Tok[] | undefined {
	const at = annotation.findIndex((t) => t.text === "<");
	const head = annotation.slice(0, Math.max(at, 0)).map((t) => t.text).join("");
	if (at === -1 || !/^(?:React\.)?(?:FC|FunctionComponent|VFC)$/.test(head)) return undefined;
	return splitTop(annotation, at + 1, skipAngles(annotation, at) - 1, [","])[0];
}

/** Scans the top level of `toks` (from `tokenize(source)`). */
export function scanScope(source: string, toks: Tok[]): Scope {
	const scope: Scope = { source, types: new Map(), interfaces: new Map(), cva: new Map(), functions: new Map(), exports: [] };
	let i = 0;
	while (i < toks.length) {
		if (isOpen(toks[i])) {
			i = matching(toks, i) + 1;
			continue;
		}
		let j = i;
		const exported = toks[j]!.text === "export";
		if (exported) j++;
		if (toks[j]?.text === "default") {
			i = j + 1;
			continue;
		}
		if (toks[j]?.text === "declare") j++;
		const tok = toks[j];
		if (!tok) break;
		const next = toks[j + 1];

		if (exported && tok.type === "{") {
			const close = matching(toks, j);
			if (toks[close + 1]?.text !== "from") {
				for (const part of splitTop(toks, j + 1, close, [","], false)) {
					if (part[0]?.text === "type" && part.length > 1 && part[1]?.text !== "as") continue;
					const local = part[0]!.text;
					scope.exports.push({ local, name: part[1]?.text === "as" && part[2] ? part[2].text : local });
				}
			}
			i = close + 1;
			continue;
		}
		if (tok.text === "async" && next?.text === "function") j++;
		if (toks[j]!.text === "function") {
			const name = toks[j + 1]?.text === "*" ? toks[j + 2] : toks[j + 1];
			const info = functionAt(toks, j);
			if (name?.type === "name" && info) {
				scope.functions.set(name.text, info);
				if (exported) scope.exports.push({ local: name.text, name: name.text });
			}
			i = j + 1;
			continue;
		}
		if ((tok.text === "const" || tok.text === "let" || tok.text === "var") && next?.type === "name") {
			let k = j + 2;
			let annotation: Tok[] = [];
			if (toks[k]?.text === ":") {
				const end = typeEnd(toks, k + 1, ["="]);
				annotation = toks.slice(k + 1, end);
				k = end;
			}
			if (toks[k]?.text === "=") {
				const init = toks[k + 1];
				if (init?.text === "cva" && toks[k + 2]?.type === "(") {
					const open = k + 2;
					scope.cva.set(next.text, cvaVariants(splitTop(toks, open + 1, matching(toks, open), [","], false)));
				} else {
					const info = functionFromInit(toks, k + 1);
					if (info) {
						info.typeArg ??= fcTypeArg(annotation);
						scope.functions.set(next.text, info);
					}
				}
			}
			if (exported) scope.exports.push({ local: next.text, name: next.text });
			i = k + 1;
			continue;
		}
		if (tok.text === "type" && next?.type === "name") {
			let k = j + 2;
			if (toks[k]?.text === "<") k = skipAngles(toks, k);
			if (toks[k]?.text === "=") {
				const end = typeEnd(toks, k + 1);
				scope.types.set(next.text, toks.slice(k + 1, end));
				i = end;
				continue;
			}
		}
		if (tok.text === "interface" && next?.type === "name") {
			let k = j + 2;
			if (toks[k]?.text === "<") k = skipAngles(toks, k);
			let heritage: Tok[][] = [];
			const brace = toks.findIndex((t, index) => index >= k && t.type === "{");
			if (brace !== -1) {
				if (toks[k]?.text === "extends") heritage = splitTop(toks, k + 1, brace, [","]);
				const close = matching(toks, brace);
				scope.interfaces.set(next.text, { heritage, body: toks.slice(brace + 1, close) });
				i = close + 1;
				continue;
			}
		}
		i = j + 1;
	}
	return scope;
}
