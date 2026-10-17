import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CatalogIcon } from "@/lib/icon-catalog";
import { cn } from "@/lib/utils";
import { ICON_PACK_IDS, ICON_PACKS, iconBase, type IconPack } from "../../../shared/icons";

const MAX_RESULTS = 120;

const catalogs = new Map<IconPack, Promise<CatalogIcon[]>>();

export function loadCatalog(pack: IconPack): Promise<CatalogIcon[]> {
	let catalog = catalogs.get(pack);

	if (!catalog) {
		catalog = import("@/lib/icon-catalog")
			.then(({ iconCatalog }) => iconCatalog(pack))
			.then((icons) => icons.sort((a, b) => a.base.localeCompare(b.base)));
		catalogs.set(pack, catalog);
	}

	return catalog;
}

const isIconPack = (value: string): value is IconPack => ICON_PACK_IDS.some((pack) => pack === value);

/** `ArrowUpRight` → `arrow up right`, so "arrow up" finds it */
const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

function search(all: CatalogIcon[], query: string): CatalogIcon[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

	if (!terms.length) return all.slice(0, MAX_RESULTS);
	const found: CatalogIcon[] = [];

	for (const entry of all) {
		const text = `${words(entry.base)} ${entry.base.toLowerCase()}`;

		if (terms.every((term) => text.includes(term))) found.push(entry);

		if (found.length === MAX_RESULTS) break;
	}

	return found;
}

/** Swaps an icon for another from any pack; `current` is the imported name, `pack` where it comes from */
export function IconPicker({
	current,
	pack: currentPack,
	disabled,
	onPick,
}: {
	current: string;
	pack: IconPack;
	disabled?: boolean;
	onPick: (icon: string, pack: IconPack) => void;
}) {
	const [open, setOpen] = useState(false);
	const [pack, setPack] = useState(currentPack);
	const [loaded, setLoaded] = useState<{ pack: IconPack; icons: CatalogIcon[] } | null>(null);
	const [query, setQuery] = useState("");
	const all = loaded?.pack === pack ? loaded.icons : null;
	const results = useMemo(() => (all ? search(all, query) : []), [all, query]);
	const base = iconBase(currentPack, current);

	useEffect(() => {
		if (!open || all) return;
		let live = true;
		void loadCatalog(pack).then((icons) => live && setLoaded({ pack, icons }));

		return () => {
			live = false;
		};
	}, [open, all, pack]);

	const pick = (icon: CatalogIcon) => {
		setOpen(false);
		setQuery("");

		if (pack !== currentPack || icon.base !== base) onPick(icon.name, pack);
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);

				if (next) setPack(currentPack);
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					aria-label="Icon"
					className="flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded-md border bg-transparent px-2 text-left font-mono text-[11px] outline-none hover:bg-accent/50 focus-visible:border-ring disabled:opacity-50 data-[state=open]:border-ring"
				>
					<span className="truncate">
						{currentPack === "lucide" ? base : `${ICON_PACKS[currentPack].label} · ${base}`}
					</span>
					<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="flex w-72 flex-col gap-2 p-2">
				<ToggleGroup
					type="single"
					size="sm"
					value={pack}
					onValueChange={(next) => {
						if (isIconPack(next)) setPack(next);
					}}
					aria-label="Icon pack"
					className="h-7 w-full"
				>
					{ICON_PACK_IDS.map((id) => (
						<ToggleGroupItem key={id} value={id} className="h-7 flex-1 px-2 text-xs">
							{ICON_PACKS[id].label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				<input
					autoFocus
					value={query}
					placeholder="Search icons…"
					aria-label="Search icons"
					spellCheck={false}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && results[0]) pick(results[0]);
					}}
					className="h-8 w-full min-w-0 rounded-md border bg-transparent px-2.5 text-[13px] outline-none placeholder:text-subtle-foreground focus:border-ring"
				/>
				{!all ? (
					<p className="px-1 py-6 text-center text-xs text-subtle-foreground">Loading icons…</p>
				) : results.length === 0 ? (
					<p className="px-1 py-6 text-center text-xs text-subtle-foreground">No icon matches “{query}”</p>
				) : (
					<div className="grid max-h-64 grid-cols-8 gap-0.5 overflow-y-auto" role="listbox" aria-label="Icons">
						{results.map((icon) => {
							const selected = pack === currentPack && icon.base === base;

							return (
								<button
									key={icon.name}
									type="button"
									role="option"
									aria-selected={selected}
									title={icon.base}
									aria-label={icon.base}
									onClick={() => pick(icon)}
									className={cn(
										"flex aspect-square items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
										selected && "bg-accent text-accent-foreground",
									)}
								>
									<icon.Icon className="size-4" />
								</button>
							);
						})}
					</div>
				)}
				{all && results.length === MAX_RESULTS ? (
					<p className="px-1 text-[11px] text-subtle-foreground">Type to find more of {all.length} icons</p>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
