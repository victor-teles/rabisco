/**
 * Finds repeated structure across project files: subtrees that are
 * structurally equivalent (shape.ts) and could become one component.
 */

import { isComponentFile, isScreenFile } from "../project";
import { extractComponent, extractionSignature, type ExtractResult } from "./extract";
import { hashString } from "./hash";
import { readImports } from "./imports";
import { componentExports, projectComponentNames } from "./modules";
import { suggestName } from "./naming";
import { structureKey, subtreeSize } from "./structure";
import { toPascal } from "./text";
import { flatten, parseFile, type JsxElement, type ParsedFile } from "./tree";

export type DuplicateOccurrence = { path: string; start: number; end: number };

export type DuplicateGroup = {
	/** Structure hash, stable while the structure doesn't change */
	key: string;
	/**
	 * In path, then source order. Exactly what "Make component" replaces when
	 * given these (`extractComponent({ …, occurrences })`): same shape and same
	 * bindings (`extractionSignature`), none inside a larger suggestion.
	 */
	occurrences: DuplicateOccurrence[];
	/** Elements in one occurrence */
	elementCount: number;
	/** Sentence case, e.g. `Stat card`; not taken by an existing component */
	suggestedName: string;
};

export type DuplicateOptions = {
	/** Smallest subtree worth a component, in elements (default 3) */
	minElements?: number;
	/** Fewest occurrences (default 2) */
	minOccurrences?: number;
	/** Look in alternates (`*.alt-N.tsx`) too; off by default, since they repeat their screen on purpose */
	includeAlternates?: boolean;
};

type Candidate = {
	key: string;
	start: number;
	end: number;
	size: number;
	element: JsxElement;
	file: ParsedFile;
	/** `extractionSignature`, computed on demand; `null` when it can't be extracted */
	signature?: string | null;
};

const candidateCache = new Map<string, Candidate[]>();

const CACHE_SIZE = 256;

/** Subtrees of one file that could be a component, memoized by path and content. */
function candidatesOf(path: string, source: string, minElements: number): Candidate[] {
	const cacheKey = `${minElements}\0${path}\0${source}`;
	const hit = candidateCache.get(cacheKey);

	if (hit) return hit;
	const file = parseFile(source);
	const components = file.ok ? projectComponentNames(path, file) : new Set<string>();
	const found: Candidate[] = [];

	for (const element of flatten(file)) {
		if (element.name === null || components.has(element.name.split(".")[0]!)) continue;
		const size = subtreeSize(element);

		if (size < minElements) continue;
		found.push({ key: structureKey(element), start: element.start, end: element.end, size, element, file });
	}

	if (candidateCache.size >= CACHE_SIZE) candidateCache.delete(candidateCache.keys().next().value!);
	candidateCache.set(cacheKey, found);

	return found;
}

/**
 * Groups of equivalent subtrees that occur at least twice across screens and
 * components, most valuable (occurrences × size) first. Occurrences inside an
 * occurrence of a larger reported group are left out, as are subtrees whose
 * root is already a project component.
 */
export function findDuplicates(files: Record<string, string>, options: DuplicateOptions = {}): DuplicateGroup[] {
	const minElements = options.minElements ?? 3;
	const minOccurrences = options.minOccurrences ?? 2;

	type Found = Candidate & { path: string; cached: Candidate };

	const byKey = new Map<string, Found[]>();

	const paths = Object.keys(files)
		.filter(
			(path) =>
				(isScreenFile(path) && (options.includeAlternates || !/\.alt-\d+\.tsx$/.test(path))) || isComponentFile(path),
		)
		.sort();

	for (const path of paths) {
		for (const candidate of candidatesOf(path, files[path]!, minElements)) {
			const found: Found = { ...candidate, path, cached: candidate };
			const list = byKey.get(candidate.key);

			if (list) list.push(found);
			else byKey.set(candidate.key, [found]);
		}
	}

	// Same shape is not enough: "Make component" only merges subtrees bound the same way
	const split: [string, Found[]][] = [];

	for (const [key, list] of byKey) {
		if (list.length < minOccurrences) continue;
		const bySignature = new Map<string, Found[]>();

		for (const candidate of list) {
			// Memoized on the cached candidate, so it's computed once per file version
			const { cached } = candidate;

			if (cached.signature === undefined)
				cached.signature = extractionSignature(candidate.path, candidate.file, candidate.element);

			if (cached.signature === null) continue;
			const same = bySignature.get(cached.signature);

			if (same) same.push(candidate);
			else bySignature.set(cached.signature, [candidate]);
		}

		for (const [signature, same] of bySignature)
			split.push([signature ? `${key}-${hashString(signature)}` : key, same]);
	}

	const groups = split
		.filter(([, list]) => list.length >= minOccurrences)
		.sort(([, a], [, b]) => b[0]!.size - a[0]!.size || b.length - a.length);

	// Larger structures first; anything inside an accepted occurrence is covered
	const covered = new Map<string, { start: number; end: number }[]>();
	const result: DuplicateGroup[] = [];
	const taken = new Set<string>();
	const exported = componentExports(files);

	for (const [key, list] of groups) {
		const free = list.filter(
			(o) => !(covered.get(o.path) ?? []).some((span) => o.start >= span.start && o.end <= span.end),
		);

		if (free.length < minOccurrences) continue;

		for (const o of free) covered.set(o.path, [...(covered.get(o.path) ?? []), { start: o.start, end: o.end }]);
		const first = free[0]!;
		result.push({
			key,
			occurrences: free.map(({ path, start, end }) => ({ path, start, end })),
			elementCount: first.size,
			suggestedName: freeName(suggestName(first.element, iconsOf(files[first.path]!)), exported, taken),
		});
	}

	return result.sort((a, b) => b.occurrences.length * b.elementCount - a.occurrences.length * a.elementCount);
}

/**
 * "Make component" on a suggestion: extracts from its first occurrence that can
 * be extracted, replacing exactly the suggestion's occurrences, so the count it
 * showed is what changes and alternates it didn't list stay as they are.
 */
export function extractSuggestion(
	files: Record<string, string>,
	group: Pick<DuplicateGroup, "occurrences">,
	name: string,
): ExtractResult {
	let failed: ExtractResult | null = null;

	for (const occurrence of group.occurrences) {
		const result = extractComponent({
			files,
			path: occurrence.path,
			start: occurrence.start,
			name,
			occurrences: group.occurrences,
		});

		if (result.ok) return result;
		failed ??= result;
	}

	return failed ?? { ok: false, reason: "Nothing to extract." };
}

function iconsOf(source: string) {
	const icons = new Set<string>();

	for (const decl of readImports(source))
		if (decl.module === "lucide-react") for (const s of decl.named) icons.add(s.local);

	return icons;
}

/** `name`, or `name 2`, `name 3`… when a component (`exported`) or another suggestion has it. */
function freeName(name: string, exported: Set<string>, taken: Set<string>) {
	let candidate = name;

	for (let n = 2; taken.has(candidate) || exported.has(toPascal(candidate)); n++) candidate = `${name} ${n}`;
	taken.add(candidate);

	return candidate;
}
