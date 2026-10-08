import { useEffect, useMemo, useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { iconBase } from "../../../shared/jsx/icons";

type Catalog = [string, LucideIcon][];

const MAX_RESULTS = 120;

let catalog: Promise<Catalog> | null = null;

const loadCatalog = () =>
	(catalog ??= import("@/lib/icon-catalog").then(({ icons }) =>
		Object.entries(icons).sort(([a], [b]) => a.localeCompare(b)),
	));

/** `ArrowUpRight` → `arrow up right`, so "arrow up" finds it */
const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

function search(all: Catalog, query: string): Catalog {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

	if (!terms.length) return all.slice(0, MAX_RESULTS);
	const found: Catalog = [];

	for (const entry of all) {
		const text = `${words(entry[0])} ${entry[0].toLowerCase()}`;

		if (terms.every((term) => text.includes(term))) found.push(entry);

		if (found.length === MAX_RESULTS) break;
	}

	return found;
}

/** Swaps a lucide icon for another; `current` is the imported name */
export function IconPicker({
	current,
	disabled,
	onPick,
}: {
	current: string;
	disabled?: boolean;
	onPick: (icon: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [all, setAll] = useState<Catalog | null>(null);
	const [query, setQuery] = useState("");
	const results = useMemo(() => (all ? search(all, query) : []), [all, query]);
	const base = iconBase(current);

	useEffect(() => {
		if (!open || all) return;
		let live = true;
		void loadCatalog().then((loaded) => live && setAll(loaded));

		return () => {
			live = false;
		};
	}, [open, all]);

	const pick = (name: string) => {
		setOpen(false);
		setQuery("");

		if (name !== base) onPick(name);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					aria-label="Icon"
					className="flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded-md border bg-transparent px-2 text-left font-mono text-[11px] outline-none hover:bg-accent/50 focus-visible:border-ring disabled:opacity-50 data-[state=open]:border-ring"
				>
					<span className="truncate">{base}</span>
					<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="flex w-72 flex-col gap-2 p-2">
				<input
					autoFocus
					value={query}
					placeholder="Search icons…"
					aria-label="Search icons"
					spellCheck={false}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && results[0]) pick(results[0][0]);
					}}
					className="h-8 w-full min-w-0 rounded-md border bg-transparent px-2.5 text-[13px] outline-none placeholder:text-subtle-foreground focus:border-ring"
				/>
				{!all ? (
					<p className="px-1 py-6 text-center text-xs text-subtle-foreground">Loading icons…</p>
				) : results.length === 0 ? (
					<p className="px-1 py-6 text-center text-xs text-subtle-foreground">No icon matches “{query}”</p>
				) : (
					<div className="grid max-h-64 grid-cols-8 gap-0.5 overflow-y-auto" role="listbox" aria-label="Icons">
						{results.map(([name, Icon]) => (
							<button
								key={name}
								type="button"
								role="option"
								aria-selected={name === base}
								title={name}
								aria-label={name}
								onClick={() => pick(name)}
								className={cn(
									"flex aspect-square items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
									name === base && "bg-accent text-accent-foreground",
								)}
							>
								<Icon className="size-4" strokeWidth={1.8} />
							</button>
						))}
					</div>
				)}
				{all && results.length === MAX_RESULTS ? (
					<p className="px-1 text-[11px] text-subtle-foreground">Type to find more of {all.length} icons</p>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
