import { transform } from "sucrase";
import { extractCandidates } from "./candidates";
import { SOURCE_URL_PREFIX, type CompileError } from "./protocol";
import { extractRequires } from "./resolve";

/** One project file after Sucrase, with what the host needs to know about it. */
export type CompiledModule = {
	path: string;
	source: string;
	/** Content hash of `path` + `source` */
	hash: string;
	/** CommonJS code ending in a `sourceURL` comment, or `null` when it did not compile */
	code: string | null;
	error: CompileError | null;
	/** Import specifiers as written, e.g. `react`, `../components/card` */
	imports: string[];
	/** Tailwind class candidates found in the source */
	candidates: string[];
};

/** 53-bit string hash (cyrb53). Fast, and collisions are checked against the source anyway. */
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

/** Import specifiers found in source, used when the file does not compile. */
function importsFromSource(source: string) {
	const found = new Set<string>();
	for (const match of source.matchAll(/\b(?:from|import)\s*(['"])([^'"\n]+)\1/g)) found.add(match[2]!);
	return [...found];
}

/** Compiles one file with Sucrase. Never throws: errors come back in `error`. */
export function compileSource(path: string, source: string): CompiledModule {
	const hash = hashString(`${path}\0${source}`);
	const candidates = extractCandidates(source);
	try {
		const { code } = transform(source, {
			transforms: ["typescript", "jsx", "imports"],
			jsxRuntime: "automatic",
			production: true,
			filePath: path,
		});
		return {
			path,
			source,
			hash,
			code: `${code}\n//# sourceURL=${SOURCE_URL_PREFIX}${path}`,
			error: null,
			imports: extractRequires(code),
			candidates,
		};
	} catch (error) {
		// 1-based line and column
		const loc = (error as { loc?: { line: number; column: number } }).loc;
		// Sucrase adds "Error transforming <path>: " and " (line:column)"; the overlay shows both already
		const message = String((error as Error)?.message ?? error)
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
		};
	}
}

const MAX_ENTRIES = 1000;

/** Compiles files, cached by content hash so unchanged files never recompile. */
export class CompileCache {
	#byHash = new Map<string, CompiledModule>();
	#byPath = new Map<string, CompiledModule>();
	hits = 0;
	misses = 0;

	get(path: string, source: string): CompiledModule {
		// Fast path: same file, same string
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

/** The cache shared by every frame in the webview. */
export const compileCache = new CompileCache();
