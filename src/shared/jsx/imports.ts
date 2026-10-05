/** Import declarations of a file: reading them, adding names and dropping names that are no longer used. */

import { TokenType as tt } from "sucrase/dist/esm/parser/tokenizer/types";
import { lineEnd, lineStart } from "./text";
import { parseFile, type ParsedFile } from "./tree";

export type ImportSpecifier = { imported: string; local: string; type: boolean };

export type ImportDecl = {
	/** `import` to the end of the statement, `;` included */
	start: number;
	end: number;
	module: string;
	quote: string;
	semicolon: boolean;
	/** `import type { … }` */
	typeOnly: boolean;
	defaultName: string | null;
	namespace: string | null;
	named: ImportSpecifier[];
	/** Span of `{ … }`, braces included */
	braces: { start: number; end: number } | null;
};

const ROLE_OBJECT_KEY = 10;

/** The file's static import declarations, in order. Empty when it does not parse. */
export function readImports(file: ParsedFile | string): ImportDecl[] {
	const parsed = typeof file === "string" ? parseFile(file) : file;
	const { source, tokens } = parsed;
	const imports: ImportDecl[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (token.type !== tt._import || tokens[i + 1]?.type === tt.parenL || tokens[i + 1]?.type === tt.dot) continue;
		let j = i + 1;
		while (j < tokens.length && tokens[j]!.type !== tt.string) j++;
		const spec = tokens[j];
		if (!spec) break;
		const semicolon = tokens[j + 1]?.type === tt.semi;
		const end = semicolon ? tokens[j + 1]!.end : spec.end;
		const clause = source
			.slice(token.end, spec.start)
			.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
			.replace(/\s*from\s*$/, "");
		const typeOnly = /^\s*type\s/.test(clause) && !/^\s*type\s*(,|from)/.test(clause);
		const body = typeOnly ? clause.replace(/^\s*type\s/, "") : clause;
		const braceStart = source.indexOf("{", token.end);
		const hasBraces = /\{/.test(body) && braceStart !== -1 && braceStart < spec.start;
		const braces = hasBraces ? { start: braceStart, end: source.indexOf("}", braceStart) + 1 } : null;
		imports.push({
			start: token.start,
			end,
			module: source.slice(spec.start + 1, spec.end - 1),
			quote: source[spec.start]!,
			semicolon,
			typeOnly,
			defaultName: /^\s*([A-Za-z_$][\w$]*)\s*(,|$)/.exec(body)?.[1] ?? null,
			namespace: /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(body)?.[1] ?? null,
			named: braces ? parseSpecifiers(source.slice(braces.start + 1, braces.end - 1)) : [],
			braces,
		});
		i = j;
	}
	return imports;
}

function parseSpecifiers(text: string): ImportSpecifier[] {
	return text
		.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
		.split(",")
		.map((part) => /^\s*(type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part))
		.filter((match) => match !== null)
		.map((match) => ({ imported: match[2]!, local: match[3] ?? match[2]!, type: !!match[1] }));
}

const specifierText = (s: ImportSpecifier) => `${s.type ? "type " : ""}${s.imported}${s.local !== s.imported ? ` as ${s.local}` : ""}`;

/** `{ A, B }`, or one specifier per line when the original braces spanned lines. */
function bracesText(source: string, decl: ImportDecl, named: ImportSpecifier[]) {
	const original = decl.braces ? source.slice(decl.braces.start, decl.braces.end) : "";
	if (original.includes("\n")) {
		const indent = /\n([ \t]+)\S/.exec(original)?.[1] ?? "\t";
		return `{\n${named.map((s) => `${indent}${specifierText(s)},`).join("\n")}\n}`;
	}
	return `{ ${named.map(specifierText).join(", ")} }`;
}

/** Local names bound by any import of the file. */
export function importedNames(imports: ImportDecl[]) {
	const names = new Set<string>();
	for (const decl of imports) {
		if (decl.defaultName) names.add(decl.defaultName);
		if (decl.namespace) names.add(decl.namespace);
		for (const s of decl.named) names.add(s.local);
	}
	return names;
}

/**
 * Adds named imports from `from`: merged into an existing import of that module,
 * or a new line after the last import (top of the file if none). Names already
 * imported are skipped. Returns the source unchanged when it does not parse.
 */
export function addImport(source: string, from: string, names: string[]): string {
	const parsed = parseFile(source);
	if (!parsed.ok) return source;
	const imports = readImports(parsed);
	const bound = new Set(imports.filter((decl) => decl.module === from).flatMap((decl) => [...importedNames([decl])]));
	const missing = [...new Set(names)].filter((name) => name && !bound.has(name));
	if (!missing.length) return source;
	const added = missing.map((name) => ({ imported: name, local: name, type: false }));
	const existing = imports.find((decl) => decl.module === from && !decl.typeOnly && !decl.namespace);
	if (existing?.braces) {
		const text = bracesText(source, existing, [...existing.named, ...added]);
		return source.slice(0, existing.braces.start) + text + source.slice(existing.braces.end);
	}
	if (existing?.defaultName) {
		const at = source.indexOf(existing.defaultName, existing.start + 6) + existing.defaultName.length;
		return `${source.slice(0, at)}, { ${missing.join(", ")} }${source.slice(at)}`;
	}
	const last = imports[imports.length - 1];
	const quote = last?.quote ?? '"';
	const line = `import { ${missing.join(", ")} } from ${quote}${from}${quote}${!last || last.semicolon ? ";" : ""}`;
	if (!last) return `${line}\n${source.startsWith("\n") || !source ? "" : "\n"}${source}`;
	const at = lineEnd(source, last.end);
	return `${source.slice(0, at)}\n${line}${source.slice(at)}`;
}

/** Names among `names` that some code outside the import declarations still refers to. */
function usedNames(parsed: ParsedFile, imports: ImportDecl[], names: Set<string>) {
	const used = new Set<string>();
	const { tokens, source } = parsed;
	let decl = 0;
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;
		while (decl < imports.length && imports[decl]!.end <= token.start) decl++;
		if (decl < imports.length && token.start >= imports[decl]!.start) continue;
		if (token.type !== tt.name && token.type !== tt.jsxName) continue;
		if (token.identifierRole === ROLE_OBJECT_KEY || tokens[i - 1]?.type === tt.dot) continue;
		const text = source.slice(token.start, token.end);
		if (names.has(text)) used.add(text);
	}
	return used;
}

/**
 * Removes the imports of `names` that nothing in the file uses anymore, and
 * whole declarations left empty. Other imports are never touched.
 */
export function removeUnusedImports(source: string, names: string[]): string {
	const parsed = parseFile(source);
	if (!parsed.ok || !names.length) return source;
	const imports = readImports(parsed);
	const used = usedNames(parsed, imports, new Set(names));
	const drop = (name: string | null) => !!name && names.includes(name) && !used.has(name);
	let out = source;
	for (const decl of [...imports].reverse()) {
		const named = decl.named.filter((s) => !drop(s.local));
		const keepDefault = decl.defaultName && !drop(decl.defaultName);
		const keepNamespace = decl.namespace && !drop(decl.namespace);
		if (named.length === decl.named.length && keepDefault === !!decl.defaultName && keepNamespace === !!decl.namespace) continue;
		if (!named.length && !keepDefault && !keepNamespace) {
			// Drop the whole line when the declaration is alone on it
			const from = lineStart(out, decl.start);
			const to = lineEnd(out, decl.end);
			const alone = !out.slice(from, decl.start).trim() && !out.slice(decl.end, to).trim();
			out = alone ? out.slice(0, from) + out.slice(Math.min(to + 1, out.length)) : out.slice(0, decl.start) + out.slice(decl.end);
			continue;
		}
		const quote = decl.quote;
		const head = decl.typeOnly ? "import type " : "import ";
		const parts = [keepDefault ? decl.defaultName : null, keepNamespace ? `* as ${decl.namespace}` : null, named.length ? bracesText(out, decl, named) : null].filter(Boolean);
		out = `${out.slice(0, decl.start)}${head}${parts.join(", ")} from ${quote}${decl.module}${quote}${decl.semicolon ? ";" : ""}${out.slice(decl.end)}`;
	}
	return out;
}
