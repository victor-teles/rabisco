import { FRAME_GAP, FRAME_SIZE, frameName, framesForNewScreens, isComponentFile, isScreenFile, nextFrameX, screenNameFromPath } from "../project";
import type { Device, FileChange, Frame, ProjectFiles } from "../types";
import { altPath, baseOf, MAX_VARIATIONS, nextAltNumber } from "../variations";
import type { GenerationEvent, ScreenMeta } from "./contract";

/**
 * Naming for parallel variations (decisions 0003 and 0004), shared by the main
 * process and the browser fallback. Variant 0 keeps the provider's paths. Every
 * other variant `k` is renamed live: screens become `*.alt-N.tsx` and the
 * components it writes become `components/<name>-v<k+1>.tsx`, with its imports
 * rewritten. Once all runs end, `combineVariations` collapses components that
 * came out the same, maps extra screens onto variant 0's and lays out frames.
 */

/** 1 to `MAX_VARIATIONS`; anything else falls back to `fallback`. */
export function clampVariations(count: number | undefined, fallback = 1) {
	const n = Number.isFinite(count) ? Math.floor(count!) : fallback;
	return Math.min(MAX_VARIATIONS, Math.max(1, n));
}

/** `screens/welcome.tsx` (or any of its alternates) for variant `k` ≥ 1 → `screens/welcome.alt-<next + k - 1>.tsx` */
export function variantScreenPath(path: string, k: number, taken: Iterable<string>) {
	const base = baseOf(path);
	return altPath(base, nextAltNumber(base, taken) + k - 1);
}

/** `components/row.tsx` for variant `k` → `components/row-v<k+1>.tsx`, skipping names in `taken` */
export function variantComponentPath(path: string, k: number, taken: Iterable<string>) {
	const used = new Set(taken);
	const stem = `${path.replace(/\.tsx$/, "")}-v${k + 1}`;
	let candidate = `${stem}.tsx`;
	for (let n = 2; used.has(candidate); n++) candidate = `${stem}-${n}.tsx`;
	return candidate;
}

const componentName = (path: string) => path.slice("components/".length, -".tsx".length);

const SPECIFIER = /(["'])(\.\.\/components\/|\.\/)([a-z0-9-]+)\1/g;

/**
 * Rewrites project-component specifiers in `content` (a file at `path`) by
 * `renames` (component path → component path): `../components/<name>`
 * anywhere, `./<name>` between components.
 */
export function rewriteImports(path: string, content: string, renames: ReadonlyMap<string, string>) {
	if (!renames.size) return content;
	return content.replace(SPECIFIER, (match, quote: string, prefix: string, name: string) => {
		if (prefix === "./" && !isComponentFile(path)) return match;
		const to = renames.get(`components/${name}.tsx`);
		return to ? `${quote}${prefix}${componentName(to)}${quote}` : match;
	});
}

/** Component paths `content` imports (resolved from `path`). */
function importedComponents(path: string, content: string) {
	const found = new Set<string>();
	for (const [, , prefix, name] of content.matchAll(SPECIFIER)) {
		if (prefix === "./" && !isComponentFile(path)) continue;
		found.add(`components/${name}.tsx`);
	}
	return found;
}

/** Renames paths by `map` and rewrites component imports to follow. */
export function renameChanges(changes: FileChange[], map: ReadonlyMap<string, string>): FileChange[] {
	const components = new Map([...map].filter(([from]) => isComponentFile(from)));
	return changes.map(({ path, content }) => {
		const to = map.get(path) ?? path;
		return { path: to, content: content === null ? null : rewriteImports(to, content, components) };
	});
}

const renameKeys = <T>(record: Record<string, T>, map: ReadonlyMap<string, string>) =>
	Object.fromEntries(Object.entries(record).map(([path, value]) => [map.get(path) ?? path, value]));

const invert = (map: ReadonlyMap<string, string>) => new Map([...map].map(([a, b]) => [b, a]));

// ---------------------------------------------------------------- live renaming

export type VariantRenamerOptions = {
	/** 0 keeps paths (only `readOnly` applies); `k` ≥ 1 renames to alternates and `-v<k+1>` components */
	variant: number;
	/** Paths that exist in the project */
	taken: Iterable<string>;
	/** Paths the run must not change (references); their writes are dropped */
	readOnly?: Iterable<string>;
};

export type VariantRenamer = {
	readonly variant: number;
	/** Provider path → name Rabisco assigned */
	readonly renames: Map<string, string>;
	/** The names Rabisco assigned; validation accepts these alternates */
	readonly assigned: Set<string>;
	/** One provider event in, the events to forward out (none when dropped; extra `file.end`s when imports change) */
	transform(event: GenerationEvent): GenerationEvent[];
};

/**
 * Renames one variant's event stream as it arrives, so validation and repairs
 * see the final names. A component write renames it for the whole variant, and
 * files that already ended are sent again with their imports rewritten.
 */
export function createVariantRenamer(options: VariantRenamerOptions): VariantRenamer {
	const { variant } = options;
	const taken = [...options.taken];
	const readOnly = new Set(options.readOnly ?? []);
	const renames = new Map<string, string>();
	const assigned = new Set<string>();
	const components = new Map<string, string>();
	/** Ended files of this variant: provider content and what was sent */
	const ended = new Map<string, { raw: string; sent: string }>();

	function rename(path: string): { path: string; added: boolean } {
		if (assigned.has(path)) return { path, added: false };
		const known = renames.get(path);
		if (known) return { path: known, added: false };
		let to: string;
		if (isScreenFile(path)) to = variantScreenPath(path, variant, taken);
		else if (isComponentFile(path)) to = variantComponentPath(path, variant, taken);
		else return { path, added: false };
		renames.set(path, to);
		assigned.add(to);
		if (isComponentFile(path)) components.set(path, to);
		return { path: to, added: isComponentFile(path) };
	}

	/** Files that ended before a component was renamed, sent again with the new import */
	function resend(): GenerationEvent[] {
		const out: GenerationEvent[] = [];
		for (const [path, file] of ended) {
			const content = rewriteImports(path, file.raw, components);
			if (content === file.sent) continue;
			file.sent = content;
			out.push({ type: "file.end", path, content });
		}
		return out;
	}

	return {
		variant,
		renames,
		assigned,
		transform(event) {
			if (!("path" in event)) return [event];
			if (readOnly.has(event.path)) return [];
			if (variant === 0) return [event];
			// Extra variations add files; they never delete the project's
			if (event.type === "file.delete") return [];
			const { path, added } = rename(event.path);
			const extra = added ? resend() : [];
			switch (event.type) {
				case "file.start":
					return [{ ...event, path }, ...extra];
				case "file.delta":
					return [{ ...event, path, text: rewriteImports(path, event.text, components) }, ...extra];
				case "file.end": {
					const content = rewriteImports(path, event.content, components);
					ended.set(path, { raw: event.content, sent: content });
					return [...extra, { ...event, path, content }];
				}
			}
		},
	};
}

// ---------------------------------------------------------------- combining

export type VariantOutput = {
	/** 0 for the primary; `k` ≥ 1 for the renamed ones */
	variant: number;
	/** Validated changes, already under the renamer's names */
	changes: FileChange[];
	/** Screen metadata from `file.start`, by final path */
	screens: Record<string, ScreenMeta | undefined>;
	/** The renamer's map: provider path → assigned name */
	renames: ReadonlyMap<string, string>;
};

export type CombineInput = {
	/** `create`: variant 0 (or the lowest successful one) is the primary. `vary`: every output is an alternate. */
	mode: "create" | "vary";
	/** Successful variants only */
	outputs: VariantOutput[];
	projectFiles: ProjectFiles;
	device: Device;
};

export type Combined = {
	changes: FileChange[];
	/** Rows are variants, columns are screens, from the canvas origin (`placeNewFrames` places them) */
	frames: Frame[];
	/** The variant whose files kept the base names; `null` for `vary` */
	primary: number | null;
	/** Screens of extra variations that matched none of the primary's screens, left out */
	dropped: string[];
};

/**
 * Renamed components whose content is the same as `reference(original)` once
 * their imports point back, and that only import renamed components that
 * collapse too: these go back to their original names.
 */
function collapsible(changes: FileChange[], renames: ReadonlyMap<string, string>, reference: (path: string) => string | undefined) {
	const back = new Map<string, string>();
	for (const [from, to] of renames) if (isComponentFile(from)) back.set(to, from);
	const written = new Map(changes.filter((c) => c.content !== null).map((c) => [c.path, c.content!]));
	const collapse = new Map<string, string>();
	for (const [renamed, original] of back) {
		const content = written.get(renamed);
		if (content !== undefined && rewriteImports(original, content, back) === reference(original)) collapse.set(renamed, original);
	}
	for (let changed = true; changed; ) {
		changed = false;
		for (const renamed of collapse.keys()) {
			const imports = importedComponents(renamed, written.get(renamed)!);
			if ([...imports].some((path) => back.has(path) && !collapse.has(path))) {
				collapse.delete(renamed);
				changed = true;
			}
		}
	}
	return collapse;
}

/** Drops collapsible components and points imports back at the original names. */
export function collapseComponents(changes: FileChange[], renames: ReadonlyMap<string, string>, reference: (path: string) => string | undefined) {
	const collapse = collapsible(changes, renames, reference);
	if (!collapse.size) return changes;
	return renameChanges(
		changes.filter((c) => !collapse.has(c.path)),
		collapse,
	);
}

const writtenScreens = (changes: FileChange[]) => changes.filter((c) => c.content !== null && isScreenFile(c.path)).map((c) => c.path);

/**
 * Maps an extra variant's screens onto the primary's: a screen whose base is a
 * primary screen stays; the others take the primary screen at their index (or
 * the next one still free) as `altPath(that, next + k - 1)`. Screens left over
 * are dropped.
 */
export function remapScreens(changes: FileChange[], primaryScreens: string[], k: number, taken: Iterable<string>) {
	const all = [...taken];
	const screens = writtenScreens(changes);
	const claimed = new Set<string>();
	const map = new Map<string, string>();
	const dropped: string[] = [];
	const keep = new Set<string>();
	for (const path of screens) {
		const base = baseOf(path);
		if (!primaryScreens.includes(base) || claimed.has(base)) continue;
		claimed.add(base);
		keep.add(path);
	}
	screens.forEach((path, index) => {
		if (keep.has(path)) return;
		const preferred = primaryScreens[index];
		const target = preferred && !claimed.has(preferred) ? preferred : primaryScreens.find((screen) => !claimed.has(screen));
		if (!target) return dropped.push(path);
		claimed.add(target);
		map.set(path, variantScreenPath(target, k, all));
	});
	const kept = changes.filter((c) => !dropped.includes(c.path));
	return { changes: renameChanges(kept, map), map, dropped };
}

function frameOf(path: string, meta: ScreenMeta | undefined, device: Device, x: number, y: number, name?: string): Frame {
	const frameDevice = meta?.device ?? device;
	return { file: path, name: frameName(meta?.name?.trim() || name || screenNameFromPath(baseOf(path)), path), device: frameDevice, x, y, ...FRAME_SIZE[frameDevice] };
}

/** Combines the successful runs of one variations request into one set of changes and frames. */
export function combineVariations({ mode, outputs, projectFiles, device }: CombineInput): Combined {
	const taken = Object.keys(projectFiles);
	const sorted = [...outputs].sort((a, b) => a.variant - b.variant);
	const frames: Frame[] = [];
	const changes: FileChange[] = [];
	const dropped: string[] = [];

	if (mode === "vary") {
		const reference = (path: string) => projectFiles[path];
		const height = FRAME_SIZE[device].height;
		sorted.forEach((output, row) => {
			const own = collapseComponents(output.changes, output.renames, reference);
			changes.push(...own);
			let x = 0;
			for (const path of writtenScreens(own).filter((p) => !(p in projectFiles))) {
				const frame = frameOf(path, output.screens[path], device, x, row * (height + FRAME_GAP));
				frames.push(frame);
				x += frame.width + FRAME_GAP;
			}
		});
		return { changes, frames, primary: null, dropped };
	}

	const [first, ...others] = sorted;
	if (!first) return { changes, frames, primary: null, dropped };
	// Variant 0 failed: the lowest one that succeeded takes the base names
	const promote = first.variant === 0 ? new Map<string, string>() : invert(first.renames);
	const primary = { changes: renameChanges(first.changes, promote), screens: renameKeys(first.screens, promote) };
	changes.push(...primary.changes);
	const primaryWritten = new Map(primary.changes.map((c) => [c.path, c.content]));
	const reference = (path: string) => (primaryWritten.has(path) ? (primaryWritten.get(path) ?? undefined) : projectFiles[path]);
	const primaryScreens = writtenScreens(primary.changes);
	const created = primary.changes.filter((c) => c.content !== null && !(c.path in projectFiles)).map((c) => c.path);
	const primaryFrames = framesForNewScreens(created, primary.screens, device);
	frames.push(...primaryFrames);

	const rows = others.map((output) => {
		const collapsed = collapseComponents(output.changes, output.renames, reference);
		const remapped = remapScreens(collapsed, primaryScreens, output.variant, taken);
		dropped.push(...remapped.dropped);
		changes.push(...remapped.changes);
		return { screens: renameKeys(output.screens, remapped.map), paths: writtenScreens(remapped.changes).filter((p) => !(p in projectFiles)) };
	});

	const sizes = [...primaryFrames, ...rows.flatMap((row) => row.paths.map((path) => FRAME_SIZE[row.screens[path]?.device ?? device]))];
	const tallest = sizes.length ? Math.max(...sizes.map((s) => s.height)) : FRAME_SIZE[device].height;
	let loose = nextFrameX(primaryFrames);
	rows.forEach((row, index) => {
		const y = (index + 1) * (tallest + FRAME_GAP);
		for (const path of row.paths) {
			const anchor = primaryFrames.find((frame) => frame.file === baseOf(path));
			const frame = frameOf(path, row.screens[path], device, anchor?.x ?? loose, y, anchor?.name);
			if (!anchor) loose += frame.width + FRAME_GAP;
			frames.push(frame);
		}
	});
	return { changes, frames, primary: first.variant, dropped };
}

/** The note appended to the primary reply. */
export function variationsNote(made: number, failed: number, dropped: number) {
	const parts: string[] = [];
	if (made > 1) parts.push(`Made ${made} variations.`);
	if (failed) parts.push(`${failed} ${failed === 1 ? "variation" : "variations"} failed.`);
	if (dropped) parts.push(`Left out ${dropped} extra ${dropped === 1 ? "screen" : "screens"} that matched none of the first variation's.`);
	return parts.join(" ");
}
