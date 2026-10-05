import { withDependents } from "../lib/render/graph";
import { SOURCE_URL_PREFIX, type FrameError, type ModulePayload } from "../lib/render/protocol";
import { isRelative, resolveRelative } from "../lib/render/resolve";

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

/** `default` is whatever the module exported; callers must check it. */
export type ModuleExports = { default?: unknown };

type Module = { exports: ModuleExports };

type RequiredModule<External> = ModuleExports | External;

type Factory<External> = (
	require: (specifier: string) => RequiredModule<External>,
	module: Module,
	exports: ModuleExports,
) => void;

/** Lines `new Function` adds before the body (ECMAScript CreateDynamicFunction). */
export const FUNCTION_HEADER_LINES = 2;

/** Stack trace lines are offset by `FUNCTION_HEADER_LINES` from the source's. */
export function evaluateModule<External>(code: string, path: string): Factory<External> {
	const body = code.replace(/\n\/\/# sourceURL=[^\n]*\s*$/, "");

	// SAFETY: the body is compiled CommonJS, which only uses its `require`, `module` and `exports`
	// parameters and returns nothing
	return new Function(
		"require",
		"module",
		"exports",
		`${body}\n//# sourceURL=${SOURCE_URL_PREFIX}${path}`,
	) as Factory<External>;
}

/** 1-based; for errors without a stack. */
export function lineOf(source: string | undefined, needle: string) {
	if (!source) return undefined;
	const index = source.split("\n").findIndex((line) => line.includes(needle));

	return index === -1 ? undefined : index + 1;
}

export class ModuleRegistry<External> {
	#externals: Readonly<Record<string, External>>;
	#evaluate: (code: string, path: string) => Factory<External>;
	#payloads = new Map<string, ModulePayload>();
	#cache = new Map<string, Module>();
	#edges = new Map<string, Set<string>>();

	constructor(externals: Readonly<Record<string, External>>, evaluate = evaluateModule<External>) {
		this.#externals = externals;
		this.#evaluate = evaluate;
	}

	/** Returns the invalidated modules, dependents included. */
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

	source(path: string) {
		return this.#payloads.get(path)?.source;
	}

	isLoaded(path: string) {
		return this.#cache.has(path);
	}

	load(path: string): ModuleExports {
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

	#require(from: string, specifier: string): RequiredModule<External> {
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
