import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { ContextFileName } from "../shared/types";
import { isDirectory } from "./project-folder";

export type FoundContextFile = {
	path: ContextFileName;
	content: string;
	/** Relative to the searched folder, e.g. `docs/design.md` */
	source: string;
};

/** In search order; `""` is the folder itself. */
export const CONTEXT_SEARCH_DIRS = ["", "docs", "doc", "design", ".github", ".rabisco"];

const NAMES: ContextFileName[] = ["PRODUCT.md", "DESIGN.md"];

/** Bigger files aren't context, and would blow up every prompt */
export const MAX_CONTEXT_FILE_BYTES = 200 * 1024;

function entries(dir: string) {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

/** Case-insensitive; first match wins per file. Throws when `dir` isn't a folder. */
export function findContextFiles(dir: string): FoundContextFile[] {
	if (!dir || !existsSync(dir)) throw new Error(`Folder not found: ${dir || "(empty path)"}`);

	if (!isDirectory(dir)) throw new Error(`Not a folder: ${dir}. Choose the repository folder to import from.`);
	const found: FoundContextFile[] = [];

	for (const name of NAMES) {
		search: for (const sub of CONTEXT_SEARCH_DIRS) {
			for (const entry of entries(join(dir, sub)).sort()) {
				if (entry.toLowerCase() !== name.toLowerCase()) continue;
				const full = join(dir, sub, entry);

				try {
					const stat = statSync(full);

					if (!stat.isFile() || stat.size > MAX_CONTEXT_FILE_BYTES) continue;
					found.push({ path: name, content: readFileSync(full, "utf-8"), source: sub ? `${sub}/${entry}` : entry });
					break search;
				} catch {}
			}
		}
	}

	return found;
}
