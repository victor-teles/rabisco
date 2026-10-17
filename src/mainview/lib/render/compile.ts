import { transform } from "sucrase";
import { ICON_PACK_IDS, ICON_PACKS, iconSpec } from "../../../shared/icons";
import { injectLocations } from "../../../shared/jsx/transforms";
import { extractCandidates } from "./candidates";
import { SOURCE_URL_PREFIX, type CompileError } from "./protocol";
import { extractRequires } from "./resolve";

function hasLocation(error: Error): error is Error & { loc: { line: number; column: number } } {
	if (!("loc" in error) || typeof error.loc !== "object" || error.loc === null) return false;
	const { loc } = error;

	return "line" in loc && "column" in loc && typeof loc.line === "number" && typeof loc.column === "number";
}

export type CompiledModule = {
	path: string;
	source: string;
	hash: string;
	code: string | null;
	error: CompileError | null;
	imports: string[];
	candidates: string[];
	/** Icons imported from a pack (`iconSpec`), so the frame can load them before rendering. */
	icons: string[];
};

/** cyrb53; collisions are checked against the source anyway. */
export function hashString(text: string, seed = 0) {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;

	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}

	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function importsFromSource(source: string) {
	const found = new Set<string>();

	for (const match of source.matchAll(/\b(?:from|import)\s*(['"])([^'"\n]+)\1/g)) found.add(match[2]!);

	return [...found];
}

const ICON_MODULES = ICON_PACK_IDS.map((pack) => ICON_PACKS[pack].module);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** `import { A, B as C }` and `import * as Icons` + `Icons.A` from an icon pack, as `iconSpec`s */
export function iconsFromSource(source: string) {
	const found = new Set<string>();

	for (const module of ICON_MODULES) {
		// Type-only imports render nothing
		for (const match of source.matchAll(
			new RegExp(`import\\s+(?!type\\s)([^;]*?)\\s+from\\s*(['"])${escapeRegExp(module)}\\2`, "g"),
		)) {
			const clause = match[1]!;
			const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? "";

			const add = (name: string) => {
				const spec = iconSpec(module, name);

				if (spec) found.add(spec);
			};

			for (const part of named.split(",")) {
				const name = part.trim().split(/\s+as\s+/)[0]!;

				if (/^[A-Z]\w*$/.test(name)) add(name);
			}

			const namespace = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause)?.[1];

			if (namespace)
				for (const use of source.matchAll(new RegExp(`\\b${escapeRegExp(namespace)}\\.([A-Z]\\w*)`, "g"))) add(use[1]!);
		}
	}

	return [...found];
}

/** Top-level `function Name` declarations, which the epilogue can rebind to stable components. */
const DECLARED = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Z][\w$]*)\s*\(/gm;

const ASSIGNED =
	/^((?:export\s+)?)const(?=\s+([A-Z][\w$]*)\s*(?::(?:=>|[^=\n])*)?=\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>))/gm;

const rebindable = (source: string) => source.replace(ASSIGNED, "$1let  ");

/**
 * Rebinds the module's components to proxies that survive a new version (`runtime/refresh.ts`), so React
 * reconciles instead of remounting. The hook calls are the signature: when they change, the proxies are new.
 */
function refreshEpilogue(path: string, source: string) {
	const names = new Set([...source.matchAll(DECLARED), ...source.matchAll(ASSIGNED)].map((match) => match.at(-1)!));
	const signature = hashString([...source.matchAll(/\buse[A-Z]\w*/g)].join(","));

	const rebind = [...names].map(
		(name) => `try { if (typeof ${name} === "function") ${name} = $r(exports, "${name}", ${name}); } catch {}`,
	);

	return `\n;try { const $r = require("rabisco:refresh")(${JSON.stringify(path)}, "${signature}"); ${rebind.join(" ")} $r.exports(exports); } catch {}`;
}

const LOCATED = /\.(tsx|jsx)$/;

/** Never throws. Injected `data-rabisco-loc` attributes stay within a line, so error lines still match `source`. */
export function compileSource(path: string, source: string): CompiledModule {
	const hash = hashString(`${path}\0${source}`);
	const candidates = extractCandidates(source);

	try {
		const rebound = rebindable(source);

		const { code } = transform(LOCATED.test(path) ? injectLocations(rebound, path) : rebound, {
			transforms: ["typescript", "jsx", "imports"],
			jsxRuntime: "automatic",
			production: true,
			filePath: path,
		});

		return {
			path,
			source,
			hash,
			code: `${code}${refreshEpilogue(path, source)}\n//# sourceURL=${SOURCE_URL_PREFIX}${path}`,
			error: null,
			imports: extractRequires(code),
			candidates,
			icons: iconsFromSource(source),
		};
	} catch (error) {
		const loc = error instanceof Error && hasLocation(error) ? error.loc : undefined;

		// Strip Sucrase's path and (line:column) decorations; the overlay shows both already
		const message = String(error instanceof Error ? error.message : error)
			.replace(/^Error transforming [^:]*: /, "")
			.replace(/\s*\(\d+:\d+\)$/, "");

		return {
			path,
			source,
			hash,
			code: null,
			error: { message, line: loc?.line ?? 1, column: loc?.column },
			imports: importsFromSource(source),
			candidates,
			icons: iconsFromSource(source),
		};
	}
}

const MAX_ENTRIES = 1000;

export class CompileCache {
	#byHash = new Map<string, CompiledModule>();
	#byPath = new Map<string, CompiledModule>();
	hits = 0;
	misses = 0;

	get(path: string, source: string): CompiledModule {
		const last = this.#byPath.get(path);

		if (last && last.source === source) {
			this.hits++;

			return last;
		}

		const hash = hashString(`${path}\0${source}`);
		let compiled = this.#byHash.get(hash);

		if (compiled && (compiled.path !== path || compiled.source !== source)) compiled = undefined;

		if (compiled) this.hits++;
		else {
			this.misses++;
			compiled = compileSource(path, source);

			if (this.#byHash.size >= MAX_ENTRIES) this.#byHash.clear();
			this.#byHash.set(hash, compiled);
		}

		this.#byPath.set(path, compiled);

		return compiled;
	}
}

export const compileCache = new CompileCache();
