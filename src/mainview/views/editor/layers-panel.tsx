import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Structure } from "@/hooks/use-structure";
import { findNode } from "@/lib/outline";
import { isBoolean } from "../../../shared/guards";
import { StructureTree, useOutline } from "./structure-tree";

const OPEN_KEY = "rabisco:layers-open";

function storedOpen() {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "true");

		return isBoolean(value) ? value : true;
	} catch {
		return true;
	}
}

type LayersPanelProps = {
	path: string;
	source: string;
	structure: Structure;
	/** Items of the right-click menu on a row, which it selects first */
	elementMenu?: () => React.ReactNode;
};

/** The Code tab's structure tree in the Design tab, as Figma's layers */
export const LayersPanel = memo(function LayersPanel({ path, source, structure, elementMenu }: LayersPanelProps) {
	const { node, nodes, select, toggle, removeNode } = structure;
	const [open, setOpen] = useState(storedOpen);
	const tree = useRef<HTMLDivElement>(null);
	const { outline, shown, stale } = useOutline(path, source);
	const selected = node && node.file === path && !stale ? findNode(outline.roots, node.start) : null;
	const extraStarts = selected ? nodes.slice(1).map((n) => n.start) : [];

	useEffect(() => localStorage.setItem(OPEN_KEY, JSON.stringify(open)), [open]);

	return (
		<section className="flex flex-col border-b">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				className="flex h-9 shrink-0 items-center gap-1 px-3 text-xs font-medium text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
			>
				{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
				Layers
			</button>
			{open ? (
				<div className="max-h-64 min-h-0 overflow-auto pb-1">
					{shown ? (
						<StructureTree
							treeRef={tree}
							label="Layers"
							file={path}
							roots={shown.roots}
							stale={stale}
							selectedStart={selected?.node.start ?? null}
							extraStarts={extraStarts}
							ancestors={selected?.ancestors ?? []}
							onSelect={(start) => select({ file: path, start })}
							onToggle={(start) => toggle({ file: path, start })}
							onDelete={removeNode}
							menu={elementMenu}
						/>
					) : (
						<p className="px-4 py-2 text-xs text-subtle-foreground">
							The layers appear once the file has no syntax errors.
						</p>
					)}
				</div>
			) : null}
		</section>
	);
});
