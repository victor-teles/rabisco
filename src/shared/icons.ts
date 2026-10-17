// Decision 0050. Screens import icons from lucide, Tabler or Phosphor; each icon is its own script in the runtime.

const FILE = /^[a-z0-9-]+$/;

export const ICON_PACKS = {
	lucide: { module: "lucide-react", label: "Lucide", dir: "" },
	tabler: { module: "@tabler/icons-react", label: "Tabler", dir: "tabler/" },
	phosphor: { module: "@phosphor-icons/react", label: "Phosphor", dir: "phosphor/" },
} as const;

export type IconPack = keyof typeof ICON_PACKS;

export const ICON_PACK_IDS: readonly IconPack[] = ["lucide", "tabler", "phosphor"];

export function iconPackOf(module: string): IconPack | null {
	return ICON_PACK_IDS.find((pack) => ICON_PACKS[pack].module === module) ?? null;
}

/** The icon an export names, for display and matching: `LucideStar` → `Star`, `IconStarFilled` → `StarFilled`, `StarIcon` → `Star` */
export function iconBase(pack: IconPack, name: string): string {
	if (pack === "tabler") return name.replace(/^Icon(?=[A-Z0-9])/, "");

	if (pack === "phosphor") return name.replace(/(?<=.)Icon$/, "");

	return name.replace(/^Lucide(?=[A-Z0-9])/, "").replace(/(?<=.)Icon$/, "");
}

/** The name to import for a base name from `iconBase` */
export const iconExport = (pack: IconPack, base: string) => (pack === "tabler" ? `Icon${base}` : base);

/** `ArrowUpRight` → `arrow-up-right`, `AB2` → `a-b2`: one file per export name, distinct on a case-insensitive disk */
export const iconFileName = (base: string) => base.replace(/(?<=.)([A-Z])/g, "-$1").toLowerCase();

/** Mirrors lucide's `toKebabCase`; the build writes a script for every alias whose kebab name differs. */
function lucideFile(name: string): string | null {
	const base = iconBase("lucide", name);

	if (!/^[A-Z]/.test(base)) return null;
	const file = base.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

	return FILE.test(file) ? file : null;
}

/** A Tabler export is outline or `…Filled`; both styles of an icon share one script */
export const isFilledTabler = (name: string) => /.Filled$/.test(iconBase("tabler", name));

function packFile(pack: IconPack, name: string): string | null {
	if (pack === "lucide") return lucideFile(name);

	if (pack === "tabler" && !/^Icon[A-Z0-9]/.test(name)) return null;
	const base = pack === "tabler" ? iconBase(pack, name).replace(/(?<=.)Filled$/, "") : iconBase(pack, name);

	if (!/^[A-Z0-9]/.test(base)) return null;
	const file = iconFileName(base);

	return FILE.test(file) ? `${ICON_PACKS[pack].dir}${file}` : null;
}

/** How compiled modules list their icons: lucide's by name (`Star`), the others as `<module>:<name>` */
export function iconSpec(module: string, name: string): string | null {
	const pack = iconPackOf(module);

	if (!pack) return null;

	return pack === "lucide" ? name : `${module}:${name}`;
}

export function parseIconSpec(spec: string): { pack: IconPack; name: string } | null {
	const at = spec.lastIndexOf(":");

	if (at === -1) return { pack: "lucide", name: spec };
	const pack = iconPackOf(spec.slice(0, at));

	return pack ? { pack, name: spec.slice(at + 1) } : null;
}

/** The runtime script of an icon, `icons/<file>.js`: `house`, `tabler/home`, `phosphor/house` */
export function iconFile(spec: string): string | null {
	const icon = parseIconSpec(spec);

	return icon ? packFile(icon.pack, icon.name) : null;
}
