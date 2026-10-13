import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { MAX_CONTEXT_FILE_BYTES } from "../shared/project";
import type { ContextFileName } from "../shared/types";
import { isDirectory } from "./project-folder";

export type FoundContextFile = {
	path: ContextFileName;
	content: string;
	/** Relative to the searched folder, e.g. `docs/design.md` */
	source: string;
};

export type ContextSearch = {
	files: FoundContextFile[];
	tooLarge: string[];
};

/** In search order; `""` is the folder itself. */
export const CONTEXT_SEARCH_DIRS = ["", "docs", "doc", "design", ".github", ".rabisco"];

const NAMES: ContextFileName[] = ["PRODUCT.md", "DESIGN.md"];

function readable<T>(source: string, read: () => T): T {
	try {
		return read();
	} catch (error) {
		throw new Error(`Couldn't read ${source}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

const entries = (dir: string, source: string) => (isDirectory(dir) ? readable(source, () => readdirSync(dir)) : []);

/** Case-insensitive; first match wins per file. Throws when `dir` isn't a folder or a match can't be read. */
export function findContextFiles(dir: string): ContextSearch {
	if (!dir || !existsSync(dir)) throw new Error(`Folder not found: ${dir || "(empty path)"}`);

	if (!isDirectory(dir)) throw new Error(`Not a folder: ${dir}. Choose the repository folder to import from.`);
	const found: FoundContextFile[] = [];
	const tooLarge: string[] = [];

	for (const name of NAMES) {
		let skipped: string | undefined;

		search: for (const sub of CONTEXT_SEARCH_DIRS) {
			for (const entry of entries(join(dir, sub), sub || "the folder").sort()) {
				if (entry.toLowerCase() !== name.toLowerCase()) continue;
				const full = join(dir, sub, entry);
				const source = sub ? `${sub}/${entry}` : entry;
				const stat = readable(source, () => statSync(full));

				if (!stat.isFile()) continue;

				if (stat.size > MAX_CONTEXT_FILE_BYTES) {
					skipped ??= source;
					continue;
				}

				found.push({ path: name, content: readable(source, () => readFileSync(full, "utf-8")), source });
				skipped = undefined;

				break search;
			}
		}

		if (skipped) tooLarge.push(skipped);
	}

	return { files: found, tooLarge };
}
