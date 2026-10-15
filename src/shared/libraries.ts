import { setDesignToken, designTokensOf, orderedTokenNames, type DesignTokens } from "./context/tokens";
import type { TokenMode } from "./context/token-edit";
import { isString } from "./guards";
import { readImports } from "./jsx/imports";
import { hashString } from "./jsx/hash";
import { isJsonObject, type Json, type JsonObject } from "./json";
import { isComponentFile, LIBRARY_FILE } from "./project";
import type { FileChange, ProjectFiles } from "./types";

export { LIBRARY_FILE };

/** In the library folder: its id and name */
export const LIBRARY_MARKER = "rabisco-library.json";

export type LibraryLink = {
	id: string;
	name: string;
	/** Hash of each component at the last sync */
	files: Record<string, string>;
	/** Each token's value at the last sync */
	tokens: DesignTokens;
};

/** A library folder's `DESIGN.md` and `components/*.tsx` */
export type LibraryContents = { id: string; name: string; files: ProjectFiles };

export type LibrarySummary = {
	id: string;
	name: string;
	path: string;
	components: number;
	tokens: number;
};

export type LibraryItem = { kind: "file"; path: string } | { kind: "token"; name: string; mode: TokenMode };

/** `undefined` is a file or token that one side doesn't have */
export type LibraryChange = {
	key: string;
	item: LibraryItem;
	project: string | undefined;
	library: string | undefined;
};

export type LibraryStatus = {
	/** Only the library changed. A `library` of `undefined` was removed there and stays here, unlinked */
	updates: LibraryChange[];
	/** Both changed, to different values */
	conflicts: LibraryChange[];
	/** Only the project changed. A `project` of `undefined` was deleted here */
	changes: LibraryChange[];
	/** Only the project has it, and it was never synced */
	additions: LibraryChange[];
};

const MODES: TokenMode[] = ["light", "dark"];

export const isLibraryPath = (path: string) => path === LIBRARY_MARKER || path === "DESIGN.md" || isComponentFile(path);

const tokenKey = (mode: TokenMode, name: string) => `token:${mode}:${name}`;

type Entry = { item: LibraryItem; value: string };

function entriesOf(files: ProjectFiles): Map<string, Entry> {
	const entries = new Map<string, Entry>();

	for (const path of Object.keys(files).sort()) {
		if (isComponentFile(path)) entries.set(path, { item: { kind: "file", path }, value: files[path]! });
	}

	const tokens = designTokensOf(files["DESIGN.md"]);

	for (const mode of MODES) {
		for (const name of orderedTokenNames(tokens[mode])) {
			entries.set(tokenKey(mode, name), { item: { kind: "token", name, mode }, value: tokens[mode][name]! });
		}
	}

	return entries;
}

/** Hash of every synced value */
function baseOf(link: LibraryLink | null): Map<string, string> {
	const base = new Map<string, string>();

	if (!link) return base;

	for (const [path, hash] of Object.entries(link.files)) base.set(path, hash);

	for (const mode of MODES) {
		for (const [name, value] of Object.entries(link.tokens[mode])) base.set(tokenKey(mode, name), hashString(value));
	}

	return base;
}

const hashOf = (value: string | undefined) => (value === undefined ? undefined : hashString(value));

export function libraryStatus(
	project: ProjectFiles,
	link: LibraryLink | null,
	library: LibraryContents,
): LibraryStatus {
	const ours = entriesOf(project);
	const theirs = entriesOf(library.files);
	const base = baseOf(link);
	const status: LibraryStatus = { updates: [], conflicts: [], changes: [], additions: [] };

	for (const key of new Set([...ours.keys(), ...theirs.keys()])) {
		const mine = ours.get(key);
		const other = theirs.get(key);
		const item = (mine ?? other)!.item;
		const change: LibraryChange = { key, item, project: mine?.value, library: other?.value };

		if (mine?.value === other?.value) continue;
		const synced = base.get(key);

		if (synced === undefined) {
			if (!other) status.additions.push(change);
			else if (!mine) status.updates.push(change);
			else status.conflicts.push(change);

			continue;
		}

		const projectChanged = hashOf(mine?.value) !== synced;
		const libraryChanged = hashOf(other?.value) !== synced;

		if (projectChanged && libraryChanged) status.conflicts.push(change);
		else if (libraryChanged) status.updates.push(change);
		else status.changes.push(change);
	}

	return status;
}

export const countStatus = (status: LibraryStatus) =>
	status.updates.length + status.conflicts.length + status.changes.length;

function serializeLink(link: LibraryLink): string {
	const files = Object.fromEntries(Object.entries(link.files).sort(([a], [b]) => a.localeCompare(b)));

	const tokens = {
		light: Object.fromEntries(orderedTokenNames(link.tokens.light).map((name) => [name, link.tokens.light[name]!])),
		dark: Object.fromEntries(orderedTokenNames(link.tokens.dark).map((name) => [name, link.tokens.dark[name]!])),
	};

	return `${JSON.stringify({ id: link.id, name: link.name, files, tokens }, null, "\t")}\n`;
}

const stringRecord = (value: Json | undefined) =>
	Object.fromEntries(
		Object.entries(isJsonObject(value) ? value : {}).flatMap(([key, entry]) =>
			isString(entry) ? [[key, entry] as const] : [],
		),
	);

function parseObject(text: string | undefined): JsonObject | null {
	if (!text) return null;

	try {
		const value: Json = JSON.parse(text);

		return isJsonObject(value) ? value : null;
	} catch {
		return null;
	}
}

export function parseLibraryLink(text: string | undefined): LibraryLink | null {
	const value = parseObject(text);

	if (!value || !isString(value.id) || !isString(value.name)) return null;
	const tokens = isJsonObject(value.tokens) ? value.tokens : {};

	return {
		id: value.id,
		name: value.name,
		files: stringRecord(value.files),
		tokens: { light: stringRecord(tokens.light), dark: stringRecord(tokens.dark) },
	};
}

export function parseLibraryMarker(text: string | undefined): { id: string; name: string } | null {
	const value = parseObject(text);

	return value && isString(value.id) && value.id && isString(value.name) ? { id: value.id, name: value.name } : null;
}

export const libraryMarker = (id: string, name: string) => `${JSON.stringify({ id, name }, null, "\t")}\n`;

/** Files are kept as a hash and tokens as their value */
const stored = (item: LibraryItem, value: string) => (item.kind === "file" ? hashString(value) : value);

/** Every value the two sides agree on counts as synced, so a link heals when they are made equal by hand */
function nextLink(
	link: LibraryLink | null,
	library: LibraryContents,
	project: ProjectFiles,
	synced: Map<string, string | undefined>,
): LibraryLink {
	const ours = entriesOf(project);
	const theirs = entriesOf(library.files);
	const values = new Map<string, Entry>();

	if (link) {
		for (const [path, hash] of Object.entries(link.files))
			values.set(path, { item: { kind: "file", path }, value: hash });

		for (const mode of MODES) {
			for (const [name, value] of Object.entries(link.tokens[mode]))
				values.set(tokenKey(mode, name), { item: { kind: "token", name, mode }, value });
		}
	}

	for (const [key, entry] of ours) {
		if (theirs.get(key)?.value === entry.value)
			values.set(key, { item: entry.item, value: stored(entry.item, entry.value) });
	}

	for (const [key, value] of synced) {
		const item = ours.get(key)?.item ?? theirs.get(key)?.item ?? values.get(key)?.item;

		if (value === undefined || !item) values.delete(key);
		else values.set(key, { item, value: stored(item, value) });
	}

	for (const key of values.keys()) if (!ours.has(key) && !theirs.has(key)) values.delete(key);

	const next: LibraryLink = { id: library.id, name: library.name, files: {}, tokens: { light: {}, dark: {} } };

	for (const { item, value } of values.values()) {
		if (item.kind === "token") next.tokens[item.mode][item.name] = value;
		else next.files[item.path] = value;
	}

	return next;
}

function withValue(files: ProjectFiles, item: LibraryItem, value: string | undefined): ProjectFiles {
	if (item.kind === "token") {
		return { ...files, "DESIGN.md": setDesignToken(files["DESIGN.md"] ?? "", item.name, item.mode, value ?? null) };
	}

	const next = { ...files };

	if (value === undefined) delete next[item.path];
	else next[item.path] = value;

	return next;
}

function withLink(files: ProjectFiles, link: LibraryLink): ProjectFiles {
	return { ...files, [LIBRARY_FILE]: serializeLink(link) };
}

const pick = (status: LibraryStatus, keys: Iterable<string>) => {
	const wanted = new Set(keys);
	const all = [...status.updates, ...status.conflicts, ...status.changes, ...status.additions];

	return all.filter((change) => wanted.has(change.key));
};

/**
 * Takes the library's value for each key. A key the library removed stays in the project and is no longer synced.
 * Without `keys`, takes every update; conflicts keep the project's value.
 */
export function takeFromLibrary(
	project: ProjectFiles,
	library: LibraryContents,
	keys?: Iterable<string>,
): ProjectFiles {
	const link = parseLibraryLink(project[LIBRARY_FILE]);
	const status = libraryStatus(project, link, library);
	const changes = keys ? pick(status, keys) : status.updates;
	const synced = new Map<string, string | undefined>();
	let files = project;

	for (const change of changes) {
		if (change.library !== undefined) files = withValue(files, change.item, change.library);
		synced.set(change.key, change.library);
	}

	return withLink(files, nextLink(link, library, files, synced));
}

/** Marks the library's value as synced, so the project's value becomes a change to publish */
export function keepMine(project: ProjectFiles, library: LibraryContents, keys: Iterable<string>): ProjectFiles {
	const link = parseLibraryLink(project[LIBRARY_FILE]);
	const synced = new Map<string, string | undefined>();

	for (const change of pick(libraryStatus(project, link, library), keys)) synced.set(change.key, change.library);

	return withLink(project, nextLink(link, library, project, synced));
}

/** The library's components that import project components it doesn't have yet get them too */
export function withDependencies(project: ProjectFiles, paths: Iterable<string>): string[] {
	const found = new Set<string>();
	const queue = [...paths];

	while (queue.length) {
		const path = queue.pop()!;

		if (found.has(path)) continue;
		found.add(path);
		const source = project[path];

		if (!source || !isComponentFile(path)) continue;

		for (const { module } of readImports(source)) {
			const name = /^\.\.?\/(?:components\/)?([a-z0-9-]+)$/.exec(module)?.[1];
			const dependency = name ? `components/${name}.tsx` : null;

			if (dependency && dependency in project && !found.has(dependency)) queue.push(dependency);
		}
	}

	return [...found];
}

export type Publish = { library: FileChange[]; project: ProjectFiles };

/** Writes the project's value of each key into the library; a value deleted here is deleted there */
export function publishToLibrary(project: ProjectFiles, library: LibraryContents, keys: Iterable<string>): Publish {
	const link = parseLibraryLink(project[LIBRARY_FILE]);
	const synced = new Map<string, string | undefined>();
	let theirs = library.files;

	for (const change of pick(libraryStatus(project, link, library), keys)) {
		theirs = withValue(theirs, change.item, change.project);
		synced.set(change.key, change.project);
	}

	const changes: FileChange[] = [];

	for (const path of new Set([...Object.keys(library.files), ...Object.keys(theirs)])) {
		if (library.files[path] !== theirs[path]) changes.push({ path, content: theirs[path] ?? null });
	}

	const published = { ...library, files: theirs };

	return { library: changes, project: withLink(project, nextLink(link, published, project, synced)) };
}

/** A new library from the project's components and tokens; the project is linked to it */
export type MadeLibrary = { library: ProjectFiles; project: ProjectFiles };

export function makeLibrary(project: ProjectFiles, id: string, name: string): MadeLibrary {
	const tokens = designTokensOf(project["DESIGN.md"]);
	let design = `# ${name}\n\nThe shared components and tokens of ${name}. Projects copy them in and sync with Rabisco.\n`;

	for (const mode of MODES) {
		for (const token of orderedTokenNames(tokens[mode]))
			design = setDesignToken(design, token, mode, tokens[mode][token]!);
	}

	const files: ProjectFiles = { [LIBRARY_MARKER]: libraryMarker(id, name), "DESIGN.md": design };

	for (const path of Object.keys(project).sort()) if (isComponentFile(path)) files[path] = project[path]!;

	const contents: LibraryContents = { id, name, files };

	return { library: files, project: withLink(project, nextLink(null, contents, project, new Map())) };
}

export function unlinkLibrary(project: ProjectFiles): ProjectFiles {
	const next = { ...project };
	delete next[LIBRARY_FILE];

	return next;
}

export const itemLabel = (item: LibraryItem) =>
	item.kind === "file"
		? item.path.replace(/^components\//, "")
		: item.mode === "dark"
			? `${item.name} (dark)`
			: item.name;
