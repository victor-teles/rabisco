import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { designTokensOf, orderedTokenNames } from "../shared/context/tokens";
import { isString } from "../shared/guards";
import {
	isLibraryPath,
	LIBRARY_MARKER,
	parseLibraryMarker,
	type LibraryContents,
	type LibrarySummary,
} from "../shared/libraries";
import { isComponentFile, toKebab } from "../shared/project";
import type { FileChange, ProjectFiles } from "../shared/types";
import { arrayOr, parseJson } from "./json";
import { isDirectory, readFileIfExists } from "./project-folder";

export type LibraryStoreOptions = {
	/** New libraries go in `<documents>/Rabisco/Libraries` */
	documentsDir: string;
	/** Holds `libraries.json`, the folders added from elsewhere */
	userDataDir: string;
	pickFolder: () => Promise<string[]>;
	showItemInFolder: (path: string) => void;
};

/** Only these files of a library folder are read or written (decision 0045) */
function assertLibraryPath(path: string) {
	if (!isString(path) || !isLibraryPath(path)) {
		throw new Error(`A library holds only DESIGN.md, components/*.tsx and ${LIBRARY_MARKER} (got "${path}")`);
	}
}

export function readLibraryFiles(dir: string): ProjectFiles {
	const files: ProjectFiles = {};
	const design = readFileIfExists(join(dir, "DESIGN.md"));

	if (design !== null) files["DESIGN.md"] = design;

	if (!isDirectory(join(dir, "components"))) return files;

	for (const name of readdirSync(join(dir, "components")).sort()) {
		const path = `components/${name}`;
		const content = isComponentFile(path) ? readFileIfExists(join(dir, path)) : null;

		if (content !== null) files[path] = content;
	}

	return files;
}

function summarize(path: string, id: string, name: string): LibrarySummary {
	const files = readLibraryFiles(path);
	const tokens = designTokensOf(files["DESIGN.md"]);

	return {
		id,
		name,
		path,
		components: Object.keys(files).filter(isComponentFile).length,
		tokens: orderedTokenNames(tokens.light, tokens.dark).length,
	};
}

export function createLibraryStore(options: LibraryStoreOptions) {
	const librariesDir = join(options.documentsDir, "Rabisco", "Libraries");
	const addedFile = join(options.userDataDir, "libraries.json");

	function added(): string[] {
		try {
			return arrayOr(parseJson(readFileIfExists(addedFile) ?? "[]")).filter(isString);
		} catch {
			return [];
		}
	}

	function writeAdded(paths: string[]) {
		mkdirSync(dirname(addedFile), { recursive: true });
		writeFileSync(addedFile, `${JSON.stringify(paths, null, "\t")}\n`);
	}

	function folders(): string[] {
		const inDocuments = isDirectory(librariesDir)
			? readdirSync(librariesDir)
					.sort()
					.map((name) => join(librariesDir, name))
			: [];

		return [...new Set([...inDocuments, ...added()])];
	}

	/** The first folder with an id wins */
	function list(): LibrarySummary[] {
		const seen = new Set<string>();
		const libraries: LibrarySummary[] = [];

		for (const path of folders()) {
			const marker = parseLibraryMarker(readFileIfExists(join(path, LIBRARY_MARKER)) ?? undefined);

			if (!marker || seen.has(marker.id)) continue;
			seen.add(marker.id);
			libraries.push(summarize(path, marker.id, marker.name));
		}

		return libraries;
	}

	function folderOf(id: string): string {
		const library = list().find((entry) => entry.id === id);

		if (!library) throw new Error("That library isn't on this Mac. Add its folder first.");

		return library.path;
	}

	function freeFolder(name: string) {
		const base = /[a-z0-9]/i.test(name) ? toKebab(name) : "library";
		let dir = join(librariesDir, base);

		for (let n = 2; existsSync(dir); n++) dir = join(librariesDir, `${base}-${n}`);

		return dir;
	}

	function write(dir: string, changes: FileChange[]) {
		for (const change of changes) assertLibraryPath(change.path);

		for (const { path, content } of changes) {
			const target = join(dir, path);

			if (content === null) {
				rmSync(target, { force: true });
				continue;
			}

			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, content);
		}
	}

	return {
		librariesDir,

		listLibraries: list,

		readLibrary(id: string): LibraryContents | null {
			const library = list().find((entry) => entry.id === id);

			return library ? { id: library.id, name: library.name, files: readLibraryFiles(library.path) } : null;
		},

		/** `null` when cancelled */
		async addLibraryFolder(): Promise<LibrarySummary | null> {
			const [picked] = (await options.pickFolder()).filter(Boolean);

			if (!picked) return null;
			const path = resolve(picked).replace(/\/+$/, "");
			const marker = parseLibraryMarker(readFileIfExists(join(path, LIBRARY_MARKER)) ?? undefined);

			if (!marker) throw new Error(`${path} is not a Rabisco library (no ${LIBRARY_MARKER})`);

			if (!added().includes(path)) writeAdded([...added(), path]);

			return list().find((entry) => entry.id === marker.id) ?? null;
		},

		/** `files` must hold the library's marker */
		createLibrary(name: string, files: ProjectFiles): LibrarySummary {
			const marker = parseLibraryMarker(files[LIBRARY_MARKER]);

			if (!marker) throw new Error(`A new library needs its ${LIBRARY_MARKER}`);
			const dir = freeFolder(name);
			write(
				dir,
				Object.entries(files).map(([path, content]) => ({ path, content })),
			);

			return summarize(dir, marker.id, marker.name);
		},

		/** The marker can't be changed or removed */
		writeLibrary(id: string, changes: FileChange[]): LibrarySummary {
			if (changes.some((change) => change.path === LIBRARY_MARKER))
				throw new Error(`${LIBRARY_MARKER} can't be changed`);
			const dir = folderOf(id);
			write(dir, changes);

			return list().find((entry) => entry.id === id)!;
		},

		revealLibrary(id: string) {
			options.showItemInFolder(folderOf(id));
		},
	};
}

export type LibraryStore = ReturnType<typeof createLibraryStore>;
