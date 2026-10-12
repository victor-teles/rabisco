const FILE = /^[a-z0-9-]+$/;

/** Mirrors lucide's `toKebabCase`; the build writes a script for every alias whose kebab name differs. */
export function iconFile(name: string): string | null {
	const base = name.replace(/^Lucide(?=[A-Z0-9])/, "").replace(/(?<=.)Icon$/, "");

	if (!/^[A-Z]/.test(base)) return null;
	const file = base.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

	return FILE.test(file) ? file : null;
}
