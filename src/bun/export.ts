import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import type { ExportFile } from "../shared/types";

/** `dir`-relative path of an export file; throws when it is absolute or leaves `dir`. */
export function assertExportPath(dir: string, path: string) {
	const target = resolve(dir, path);
	const inside = relative(resolve(dir), target);

	if (!path || isAbsolute(path) || inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
		throw new Error(`Export paths stay inside the export folder (got "${path}")`);
	}

	return target;
}

/**
 * Writes `files` into `dir` (created when missing), after validating every path,
 * so a bad path writes nothing. `base64` content is written as bytes.
 */
export function writeExportFiles(dir: string, files: ExportFile[]) {
	if (!isAbsolute(dir)) throw new Error(`Export folder must be an absolute path (got "${dir}")`);
	const targets = files.map((file) => assertExportPath(dir, file.path));
	files.forEach((file, i) => {
		const target = targets[i]!;
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.encoding === "base64" ? Buffer.from(file.content, "base64") : file.content);
	});
}

/** `<parent>/<name>`, with `-2`, `-3`… when taken, so an export never overwrites an earlier one. */
export function freeExportDir(parent: string, name: string) {
	let dir = join(parent, name);

	for (let n = 2; existsSync(dir); n++) dir = join(parent, `${name}-${n}`);

	return dir;
}
