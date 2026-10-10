export const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

export function isRelative(specifier: string) {
	return specifier.startsWith("./") || specifier.startsWith("../");
}

export function joinPath(from: string, specifier: string) {
	const parts = from.split("/").slice(0, -1);

	for (const part of specifier.split("/")) {
		if (part === "" || part === ".") continue;

		if (part === "..") parts.pop();
		else parts.push(part);
	}

	return parts.join("/");
}

/** Tries the path as written, then each extension, then as a folder index. */
export function resolveRelative(from: string, specifier: string, exists: (path: string) => boolean): string | null {
	const base = joinPath(from, specifier);

	if (exists(base)) return base;

	for (const ext of EXTENSIONS) if (exists(base + ext)) return base + ext;

	for (const ext of EXTENSIONS) if (exists(`${base}/index${ext}`)) return `${base}/index${ext}`;

	return null;
}

export function extractRequires(code: string): string[] {
	const found = new Set<string>();

	for (const match of code.matchAll(/\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g)) found.add(match[2]!);

	return [...found];
}
