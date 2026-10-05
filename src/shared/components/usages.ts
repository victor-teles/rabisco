import { isRelative, joinPath } from "../../mainview/lib/render/resolve";
import { isComponentFile, isScreenFile } from "../project";
import type { ComponentSignature } from "../ai/contract";
import { componentApi, propsSignature, type ComponentApi, type ComponentExport } from "./api";

export type ComponentUsage = {
	path: string;
	/** `default` / `*` for default and namespace imports */
	names: string[];
};

export type ProjectComponent = {
	path: string;
	exports: ComponentExport[];
	usedBy: string[];
};

const IMPORT = /^\s*import\s+(type\s+)?([^'";]*?)\s+from\s+(['"])([^'"\n]+)\3/gm;

const SIDE_EFFECT = /^\s*import\s+(['"])([^'"\n]+)\1/gm;

/** `A, { B, C as D, type E }` → default, B, C */
function importedNames(clause: string): string[] {
	const names: string[] = [];
	const braces = /\{([^}]*)\}/.exec(clause);

	const head = clause
		.replace(/\{[^}]*\}/, "")
		.replace(/,/g, " ")
		.trim();

	if (/^\*\s+as\s+/.test(head)) names.push("*");
	else if (head) names.push("default");

	for (const part of braces?.[1]?.split(",") ?? []) {
		const name = part
			.trim()
			.split(/\s+as\s+/)[0]!
			.trim();

		if (name && !name.startsWith("type ")) names.push(name);
	}

	return names;
}

function resolveIn(files: Record<string, string>, from: string, specifier: string): string | null {
	const base = joinPath(from, specifier);

	for (const candidate of [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`])
		if (candidate in files) return candidate;

	return null;
}

export function componentUsages(files: Record<string, string>): Map<string, ComponentUsage[]> {
	const usages = new Map<string, ComponentUsage[]>();

	for (const path of Object.keys(files).sort()) if (isComponentFile(path)) usages.set(path, []);

	for (const path of Object.keys(files).sort()) {
		if (!/\.(tsx|ts|jsx|js)$/.test(path)) continue;
		const source = files[path]!;
		const found = new Map<string, Set<string>>();

		const add = (specifier: string, names: string[]) => {
			if (!isRelative(specifier)) return;
			const target = resolveIn(files, path, specifier);

			if (!target || target === path || !usages.has(target)) return;
			const set = found.get(target) ?? new Set<string>();

			for (const name of names) set.add(name);
			found.set(target, set);
		};

		for (const match of source.matchAll(IMPORT)) if (!match[1]) add(match[4]!, importedNames(match[2]!));

		for (const match of source.matchAll(SIDE_EFFECT)) add(match[2]!, []);

		for (const [target, names] of found) usages.get(target)?.push({ path, names: [...names] });
	}

	return usages;
}

/** Directly or transitively through other components: screen → the given components it reaches. */
export function screensUsing(files: Record<string, string>, components: string[]): Map<string, string[]> {
	const usages = componentUsages(files);
	const reached = new Map<string, Set<string>>();

	for (const component of components) {
		if (!usages.has(component)) continue;
		const seen = new Set([component]);
		const queue = [component];

		while (queue.length) {
			for (const { path } of usages.get(queue.shift()!) ?? []) {
				if (isScreenFile(path)) {
					const set = reached.get(path) ?? new Set<string>();
					set.add(component);
					reached.set(path, set);
				} else if (usages.has(path) && !seen.has(path)) {
					seen.add(path);
					queue.push(path);
				}
			}
		}
	}

	return new Map([...reached].sort(([a], [b]) => a.localeCompare(b)).map(([screen, set]) => [screen, [...set].sort()]));
}

const apiCache = new Map<string, ComponentApi>();

export function cachedComponentApi(path: string, source: string): ComponentApi {
	const key = `${path}\0${source}`;
	let api = apiCache.get(key);

	if (!api) {
		if (apiCache.size > 500) apiCache.clear();
		api = componentApi(path, source);
		apiCache.set(key, api);
	}

	return api;
}

export function projectComponents(files: Record<string, string>): ProjectComponent[] {
	const usages = componentUsages(files);

	return [...usages].map(([path, users]) => ({
		path,
		exports: cachedComponentApi(path, files[path]!).exports,
		usedBy: users.map((usage) => usage.path),
	}));
}

export function componentSignatures(files: Record<string, string>): ComponentSignature[] {
	return projectComponents(files).map(({ path, exports, usedBy }) => {
		const component: ComponentSignature = { path, signature: exports.map(propsSignature) };

		if (usedBy.length) component.usedBy = usedBy;

		return component;
	});
}
