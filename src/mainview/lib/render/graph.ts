import type { ProjectFiles } from "../../../shared/types";
import type { CompiledModule, CompileCache } from "./compile";
import { isRelative, resolveRelative } from "./resolve";

export type ModuleGraph = {
	entry: string;
	/** Every project module reachable from the entry, entry first */
	modules: Map<string, CompiledModule>;
	/** Resolved project imports of each module */
	edges: Map<string, string[]>;
	/** Relative imports that match no file */
	missing: { from: string; specifier: string }[];
};

/** Compiles the entry and everything it imports from the project, following relative imports. */
export function collectGraph(entry: string, files: ProjectFiles, cache: CompileCache): ModuleGraph {
	const graph: ModuleGraph = { entry, modules: new Map(), edges: new Map(), missing: [] };
	const exists = (path: string) => Object.hasOwn(files, path);

	if (!exists(entry)) return graph;
	const queue = [entry];

	while (queue.length > 0) {
		const path = queue.shift()!;

		if (graph.modules.has(path)) continue;
		const compiled = cache.get(path, files[path]!);
		graph.modules.set(path, compiled);
		const edges: string[] = [];

		for (const specifier of compiled.imports) {
			if (!isRelative(specifier)) continue;
			const resolved = resolveRelative(path, specifier, exists);

			if (!resolved) graph.missing.push({ from: path, specifier });
			else {
				edges.push(resolved);

				if (!graph.modules.has(resolved)) queue.push(resolved);
			}
		}

		graph.edges.set(path, edges);
	}

	return graph;
}

/** `changed` plus every module that imports one of them, directly or not. */
export function withDependents(changed: Iterable<string>, edges: ReadonlyMap<string, Iterable<string>>): Set<string> {
	const dependents = new Map<string, string[]>();

	for (const [from, targets] of edges) {
		for (const target of targets) {
			const list = dependents.get(target);

			if (list) list.push(from);
			else dependents.set(target, [from]);
		}
	}

	const result = new Set<string>();
	const stack = [...changed];

	while (stack.length > 0) {
		const path = stack.pop()!;

		if (result.has(path)) continue;
		result.add(path);

		for (const parent of dependents.get(path) ?? []) stack.push(parent);
	}

	return result;
}
