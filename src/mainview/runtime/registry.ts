import { withDependents } from "../lib/render/graph";
import { SOURCE_URL_PREFIX, type FrameError, type ModulePayload } from "../lib/render/protocol";
import { isRelative, resolveRelative } from "../lib/render/resolve";

/** An error that already knows which project file and line it belongs to. */
export class RenderError extends Error {
	kind: FrameError["kind"];
	file?: string;
	line?: number;
	column?: number;
	constructor(kind: FrameError["kind"], message: string, file?: string, line?: number, column?: number) {
		super(message);
		this.name = kind === "compile" ? "SyntaxError" : "Error";
		this.kind = kind;
		this.file = file;
		this.line = line;
		this.column = column;
	}
}

type Module = { exports: Record<string, unknown> };
type Factory = (require: (specifier: string) => unknown, module: Module, exports: Module["exports"]) => void;

/**
 * Wraps compiled CommonJS in a function. Indirect eval keeps the code on its original lines
 * (`new Function` adds a header line), so stack traces point at the right source line.
 */
export function evaluateModule(code: string, path: string): Factory {
	const body = code.replace(/\n\/\/# sourceURL=[^\n]*\s*$/, "");
	return (0, eval)(`(function (require, module, exports) {${body}\n})\n//# sourceURL=${SOURCE_URL_PREFIX}${path}`);
}

/** Line of `source` that mentions `needle`, 1-based, for errors without a stack. */
export function lineOf(source: string | undefined, needle: string) {
	if (!source) return undefined;
	const index = source.split("\n").findIndex((line) => line.includes(needle));
	return index === -1 ? undefined : index + 1;
}

/**
 * The module registry of one frame. Bare specifiers resolve to `externals` (the runtime's
 * React, lucide and shadcn components); relative ones to project modules sent by the host.
 */
export class ModuleRegistry {
	#externals: Record<string, unknown>;
	#evaluate: (code: string, path: string) => Factory;
	#payloads = new Map<string, ModulePayload>();
	#cache = new Map<string, Module>();
	/** Project modules each evaluated module required, recorded at runtime */
	#edges = new Map<string, Set<string>>();

	constructor(externals: Record<string, unknown>, evaluate = evaluateModule) {
		this.#externals = externals;
		this.#evaluate = evaluate;
	}

	/** Applies an update from the host. Returns the modules it invalidated, dependents included. */
	apply(modules: Record<string, ModulePayload | null>, reset = false): Set<string> {
		if (reset) {
			const all = new Set(this.#cache.keys());
			this.#payloads.clear();
			this.#cache.clear();
			this.#edges.clear();
			for (const [path, payload] of Object.entries(modules)) if (payload) this.#payloads.set(path, payload);
			return all;
		}
		const changed = Object.keys(modules);
		const invalid = withDependents(changed, this.#edges);
		for (const path of invalid) {
			this.#cache.delete(path);
			this.#edges.delete(path);
		}
		for (const [path, payload] of Object.entries(modules)) {
			if (payload) this.#payloads.set(path, payload);
			else this.#payloads.delete(path);
		}
		return invalid;
	}

	has(path: string) {
		return this.#payloads.has(path);
	}

	/** Original source of a project module, for error excerpts. */
	source(path: string) {
		return this.#payloads.get(path)?.source;
	}

	/** Whether the module is evaluated and cached. */
	isLoaded(path: string) {
		return this.#cache.has(path);
	}

	/** Loads a project module by path and returns its exports. */
	load(path: string): Record<string, unknown> {
		const cached = this.#cache.get(path);
		if (cached) return cached.exports;
		const payload = this.#payloads.get(path);
		if (!payload) throw new RenderError("missing-module", `Module not found: ${path}`, path);
		if (payload.error) {
			const { message, line, column } = payload.error;
			throw new RenderError("compile", message, path, line, column);
		}
		const module: Module = { exports: {} };
		// Cached before it runs, so import cycles see the partial exports like in Node
		this.#cache.set(path, module);
		this.#edges.set(path, new Set());
		try {
			this.#evaluate(payload.code, path)((specifier) => this.#require(path, specifier), module, module.exports);
		} catch (error) {
			this.#cache.delete(path);
			throw error;
		}
		return module.exports;
	}

	#require(from: string, specifier: string): unknown {
		if (isRelative(specifier)) {
			const resolved = resolveRelative(from, specifier, (path) => this.#payloads.has(path));
			if (!resolved) {
				throw new RenderError(
					"missing-module",
					`Cannot find module "${specifier}" imported from ${from}`,
					from,
					lineOf(this.source(from), specifier),
				);
			}
			this.#edges.get(from)?.add(resolved);
			return this.load(resolved);
		}
		const bare = specifier.replace(/\.(tsx|ts|jsx|js)$/, "");
		if (Object.hasOwn(this.#externals, bare)) return this.#externals[bare];
		throw new RenderError(
			"missing-module",
			`Cannot find module "${specifier}" imported from ${from}. Screens can import react, lucide-react, @/lib/utils, @/components/ui/* and project files.`,
			from,
			lineOf(this.source(from), specifier),
		);
	}
}
