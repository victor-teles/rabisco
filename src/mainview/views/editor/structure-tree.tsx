import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronRight, Component } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { elementHover } from "@/lib/element-hover";
import { buildOutline, visibleRows, type Outline, type OutlineNode } from "@/lib/outline";
import { cn } from "@/lib/utils";
import { keepMovedFocus } from "./action-menu";
import { treeOwnsKey } from "./shortcuts";

/** While the source doesn't parse (mid-typing), keeps the last good outline; `stale` then says to show it inert */
export function useOutline(path: string, source: string) {
	const [lastGood, setLastGood] = useState<Outline | null>(null);
	const outline = useMemo(() => buildOutline(path, source), [path, source]);

	if (outline.ok && outline !== lastGood) setLastGood(outline);

	return { outline, shown: outline.ok ? outline : lastGood, stale: !outline.ok };
}

function contextChip(node: OutlineNode): { text: string; title: string } | null {
	const context = node.context;

	if (!context) return null;

	switch (context.kind) {
		case "map":
			return { text: "map", title: "Repeated for each item" };
		case "conditional":
			return { text: "if", title: "Shown conditionally" };
		case "prop":
			return { text: `${context.name}=`, title: `Passed as the ${context.name} prop` };
		default:
			return { text: "{…}", title: "Inside an expression" };
	}
}

const noHover = () => null;

const NO_STARTS: readonly number[] = [];

const subscribeNone = () => () => {};

/** ⌫ deletes the element (undoable). With `file`, hovering a row outlines its element on the canvas, and the other way round */
export function StructureTree({
	treeRef,
	label = "Structure",
	file,
	roots,
	stale,
	selectedStart,
	extraStarts = NO_STARTS,
	ancestors,
	onSelect,
	onToggle,
	onMake,
	onDelete,
	menu,
}: {
	treeRef: React.RefObject<HTMLDivElement | null>;
	label?: string;
	file?: string;
	roots: OutlineNode[];
	stale: boolean;
	selectedStart: number | null;
	/** Rows ⇧-click added to the selection */
	extraStarts?: readonly number[];
	ancestors: OutlineNode[];
	onSelect: (start: number) => void;
	/** ⇧-click or ⌘-click on a row adds or removes it; without it, they select it */
	onToggle?: (start: number) => void;
	/** ↵ on a row; without it, ↵ goes on to the editor's actions */
	onMake?: () => void;
	onDelete: () => void;
	menu?: () => React.ReactNode;
}) {
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
	/** The items render only while open, so they read the editor's latest actions */
	const [menuOpen, setMenuOpen] = useState(false);
	// A selection made elsewhere (code click, make component) opens its ancestors and scrolls into view
	const ancestorKeys = ancestors.map((a) => a.key).join(" ");
	const [openedFor, setOpenedFor] = useState("");

	const hover = useSyncExternalStore(
		file ? elementHover.subscribe : subscribeNone,
		file ? elementHover.current : noHover,
	);

	const hoveredStart = hover && hover.from === "canvas" && hover.file === file ? hover.start : null;

	if (ancestorKeys !== openedFor) {
		setOpenedFor(ancestorKeys);
		const keys = ancestorKeys ? ancestorKeys.split(" ").filter((key) => collapsed.has(key)) : [];

		if (keys.length) {
			const next = new Set(collapsed);

			for (const key of keys) next.delete(key);
			setCollapsed(next);
		}
	}

	const rows = useMemo(() => visibleRows(roots, collapsed), [roots, collapsed]);
	const index = selectedStart === null ? -1 : rows.findIndex((row) => row.start === selectedStart);
	const selectedRow = index === -1 ? null : rows[index]!;

	useEffect(() => {
		if (selectedRow)
			treeRef.current?.querySelector(`[data-key="${selectedRow.key}"]`)?.scrollIntoView({ block: "nearest" });
	}, [selectedRow, treeRef]);

	// The pointer may leave while the tree unmounts (tab switch), which sends no pointerleave
	useEffect(() => () => elementHover.clear("layers"), []);

	const toggle = (key: string, value?: boolean) =>
		setCollapsed((current) => {
			const next = new Set(current);

			if (value ?? !next.has(key)) next.add(key);
			else next.delete(key);

			return next;
		});

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		// Arrows and ⌫ act on the tree, never the selected screen: keep them from the canvas even while inert
		if (treeOwnsKey(event.key)) {
			event.preventDefault();
			event.stopPropagation();
		}

		if (stale || !rows.length) return;
		const row = selectedRow;

		const go = (target: OutlineNode | undefined) => {
			event.preventDefault();

			if (target) onSelect(target.start);
		};

		switch (event.key) {
			case "ArrowDown":
				return go(row ? rows[index + 1] : rows[0]);
			case "ArrowUp":
				return go(row ? rows[index - 1] : rows[rows.length - 1]);
			case "Home":
				return go(rows[0]);
			case "End":
				return go(rows[rows.length - 1]);
			case "ArrowRight":
				if (!row) return go(rows[0]);
				event.preventDefault();

				if (row.children.length && collapsed.has(row.key)) toggle(row.key, false);
				else if (row.children.length) onSelect(row.children[0]!.start);

				return;
			case "ArrowLeft": {
				if (!row) return;
				event.preventDefault();

				if (row.children.length && !collapsed.has(row.key)) toggle(row.key, true);
				else {
					const parent = rows
						.slice(0, index)
						.reverse()
						.find((r) => r.depth < row.depth);

					if (parent) onSelect(parent.start);
				}

				return;
			}

			case "Enter":
				// ⇧↵ selects the parent
				if (row && !event.shiftKey && onMake) {
					event.preventDefault();
					onMake();
				}

				return;
			case "Backspace":
			case "Delete":
				// The element, not the screen: keep ⌫ from reaching the canvas
				event.preventDefault();

				if (row) onDelete();

				return;
		}
	};

	if (!rows.length) return <p className="px-4 py-3 text-xs text-subtle-foreground">No JSX in this file.</p>;
	const minDepth = Math.min(...roots.map((root) => root.depth));

	const tree = (
		<div
			ref={treeRef}
			role="tree"
			aria-label={label}
			aria-activedescendant={selectedRow ? `outline-${selectedRow.key}` : undefined}
			tabIndex={0}
			onKeyDown={onKeyDown}
			onPointerLeave={file ? () => elementHover.clear("layers") : undefined}
			className={cn("py-1 outline-none focus-visible:bg-accent/30", stale && "pointer-events-none opacity-50")}
		>
			{rows.map((row) => {
				const chip = contextChip(row);
				const isSelected = row === selectedRow;
				const alsoSelected = extraStarts.includes(row.start);
				const hasChildren = row.children.length > 0;
				const isComponent = row.kind === "component";

				return (
					<div
						key={row.key}
						id={`outline-${row.key}`}
						data-key={row.key}
						role="treeitem"
						aria-level={row.depth - minDepth + 1}
						aria-selected={isSelected || alsoSelected}
						aria-expanded={hasChildren ? !collapsed.has(row.key) : undefined}
						onClick={(event) => {
							if (onToggle && (event.shiftKey || event.metaKey || event.ctrlKey)) onToggle(row.start);
							else onSelect(row.start);
							treeRef.current?.focus();
						}}
						onDoubleClick={() => hasChildren && toggle(row.key)}
						onContextMenu={() => {
							// The menu acts on every selected row, as in Figma
							if (!isSelected && !alsoSelected) onSelect(row.start);
							treeRef.current?.focus();
						}}
						// Fragments have no box to outline
						onPointerEnter={
							file
								? () =>
										row.kind === "fragment"
											? elementHover.clear("layers")
											: elementHover.set({ file, start: row.start, from: "layers" })
								: undefined
						}
						className={cn(
							"flex h-6 cursor-default items-center gap-1 pr-3 text-xs select-none hover:bg-accent/60",
							row.start === hoveredStart && "bg-accent/60",
							(isSelected || alsoSelected) && "bg-accent hover:bg-accent",
						)}
						style={{ paddingLeft: 8 + (row.depth - minDepth) * 12 }}
					>
						<span
							className="grid size-4 shrink-0 place-items-center text-subtle-foreground"
							onClick={(event) => {
								if (!hasChildren) return;
								event.stopPropagation();
								toggle(row.key);
							}}
						>
							{hasChildren ? (
								collapsed.has(row.key) ? (
									<ChevronRight className="size-3" />
								) : (
									<ChevronDown className="size-3" />
								)
							) : null}
						</span>
						{isComponent ? (
							<Component className="size-3 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
						) : null}
						<span
							className={cn(
								"shrink-0 font-mono text-[11px]",
								isComponent
									? "font-medium text-violet-700 dark:text-violet-300"
									: row.kind === "fragment"
										? "text-subtle-foreground italic"
										: "text-foreground/80",
							)}
						>
							{row.label}
						</span>
						{chip ? (
							<span
								title={chip.title}
								className="shrink-0 rounded-sm bg-muted px-1 font-mono text-[10px]/4 text-muted-foreground"
							>
								{chip.text}
							</span>
						) : null}
						{row.hint ? (
							<span className="min-w-0 truncate text-subtle-foreground" title={row.hint}>
								{row.hint}
							</span>
						) : null}
					</div>
				);
			})}
		</div>
	);

	if (!menu) return tree;

	return (
		<ContextMenu onOpenChange={setMenuOpen}>
			<ContextMenuTrigger
				asChild
				// Only rows have a menu
				onContextMenu={(event) => {
					if (!(event.target instanceof Element && event.target.closest("[role=treeitem]"))) event.preventDefault();
				}}
			>
				{tree}
			</ContextMenuTrigger>
			<ContextMenuContent className="w-52" onCloseAutoFocus={keepMovedFocus}>
				{menuOpen ? menu() : null}
			</ContextMenuContent>
		</ContextMenu>
	);
}
