import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Component, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Structure } from "@/hooks/use-structure";
import { buildOutline, findNode, visibleRows, type Outline, type OutlineNode } from "@/lib/outline";
import { cn } from "@/lib/utils";
import { elementAt, findElement, parseJsx, readImports, suggestName } from "../../../shared/jsx";
import { isBoolean, isNumber } from "../../../shared/guards";
import { CodeEditor, CodeHeader } from "./code-view";
import { CODE_VIEW_KEYS, isMakeComponent, MAKE_COMPONENT_KEYS, treeOwnsKey } from "./shortcuts";

type CodePanelProps = {
	/** The one selected file (screen or component), or null */
	path: string | null;
	source: string | undefined;
	/** Why there is no file: nothing or several things selected */
	emptyMessage: string;
	structure: Structure;
	onEndStep: () => void;
	onUndo: () => void;
	onRedo: () => void;
	/** Shows the selected element's props (Design tab) */
	onShowProps: () => void;
};

const OPEN_KEY = "rabisco:structure-open";

const HEIGHT_KEY = "rabisco:structure-height";

const MIN_HEIGHT = 80;

const DEFAULT_HEIGHT = 220;

function stored<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
	try {
		const raw = localStorage.getItem(key);
		const value: unknown = raw === null ? null : JSON.parse(raw);

		return isValid(value) ? value : fallback;
	} catch {
		return fallback;
	}
}

/**
 * The Code tab: the selected file's structure (select an element, make it a
 * component) above its editable source. Selecting in either one selects in
 * the other.
 */
export function CodePanel(props: CodePanelProps) {
	const { path, source, emptyMessage } = props;

	if (!path) return <p className="p-4 text-[13px] text-subtle-foreground">{emptyMessage}</p>;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<CodeHeader path={path} source={source} />
			{source === undefined ? (
				<p className="p-4 text-[13px] text-subtle-foreground">This file is missing on disk.</p>
			) : (
				<FileCode key={path} {...props} path={path} source={source} />
			)}
		</div>
	);
}

function FileCode({
	path,
	source,
	structure,
	onEndStep,
	onUndo,
	onRedo,
	onShowProps,
}: CodePanelProps & { path: string; source: string }) {
	const { node, select, busy, naming, setNaming, makeComponent, editCode } = structure;
	const [open, setOpen] = useState(() => stored(OPEN_KEY, true, isBoolean));
	const [height, setHeight] = useState(() => stored(HEIGHT_KEY, DEFAULT_HEIGHT, isNumber));
	const [revealKey, setRevealKey] = useState(0);
	const tree = useRef<HTMLDivElement>(null);
	const container = useRef<HTMLDivElement>(null);

	// While the source doesn't parse (mid-typing), keep showing the last good outline, inert
	const [lastGood, setLastGood] = useState<Outline | null>(null);
	const outline = useMemo(() => buildOutline(path, source), [path, source]);

	if (outline.ok && outline !== lastGood) setLastGood(outline);
	const shown = outline.ok ? outline : lastGood;
	const stale = !outline.ok;

	const selected = node && !stale ? findNode(outline.roots, node.start) : null;

	useEffect(() => localStorage.setItem(OPEN_KEY, JSON.stringify(open)), [open]);
	useEffect(() => localStorage.setItem(HEIGHT_KEY, JSON.stringify(height)), [height]);

	const pick = (start: number, reveal: boolean) => {
		select({ file: path, start });

		if (reveal) setRevealKey((key) => key + 1);
	};

	// A running generation would overwrite the result with files from before it
	const startNaming = () => {
		if (!selected) return;

		if (busy) toast("Wait for the generation to finish");
		else setNaming(true);
	};

	return (
		<div ref={container} className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-9 shrink-0 items-center gap-1 border-b pr-2 pl-2">
				<button
					type="button"
					onClick={() => setOpen((value) => !value)}
					aria-expanded={open}
					className="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
				>
					{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
					Structure
				</button>
				<div className="flex-1" />
				{selected?.node.kind === "component" ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onShowProps}>
								<SlidersHorizontal />
								Props
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							Edit its props in Design <Kbd>{CODE_VIEW_KEYS}</Kbd>
						</TooltipContent>
					</Tooltip>
				) : null}
				<Tooltip>
					<TooltipTrigger asChild>
						{/* aria-disabled keeps the tooltip reachable without a selection */}
						<Button
							variant="ghost"
							size="xs"
							aria-disabled={!selected}
							className={cn("text-muted-foreground", !selected && "opacity-50 hover:bg-transparent")}
							onClick={startNaming}
						>
							<Component />
							Make component
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						{!selected ? "Select an element first" : busy ? "Wait for the generation to finish" : "Make component"}{" "}
						<Kbd>{MAKE_COMPONENT_KEYS}</Kbd>
					</TooltipContent>
				</Tooltip>
			</div>

			{naming && selected ? (
				<NameField
					key={`${path}:${selected.node.start}`}
					source={source}
					start={selected.node.start}
					onSubmit={(name) => {
						if (makeComponent(name)) tree.current?.focus();
					}}
					onCancel={() => {
						setNaming(false);
						tree.current?.focus();
					}}
				/>
			) : null}

			{open ? (
				<>
					<div className="min-h-0 shrink-0 overflow-auto" style={{ height }}>
						{shown ? (
							<StructureTree
								treeRef={tree}
								roots={shown.roots}
								stale={stale}
								selectedStart={selected?.node.start ?? null}
								ancestors={selected?.ancestors ?? []}
								onSelect={(start) => pick(start, true)}
								onMake={startNaming}
								onDelete={structure.removeNode}
							/>
						) : (
							<p className="px-4 py-3 text-xs text-subtle-foreground">
								The structure appears once the file has no syntax errors.
							</p>
						)}
						{stale && shown ? (
							<p className="sticky bottom-0 border-t bg-background px-4 py-1.5 text-xs text-subtle-foreground">
								Syntax error: the structure updates once the code parses.
							</p>
						) : null}
					</div>
					<Divider height={height} onHeightChange={setHeight} container={container} />
				</>
			) : null}

			{busy ? (
				<p className="shrink-0 border-b bg-muted/40 px-4 py-1.5 text-xs text-subtle-foreground">
					Read-only while generating
				</p>
			) : null}
			<CodeEditor
				source={source}
				readOnly={busy}
				label={`${path} source`}
				highlight={selected ? { start: selected.node.start, end: selected.node.end } : null}
				revealKey={revealKey}
				onEdit={(text, step) => editCode(path, text, `${path}:${step}`)}
				onEndStep={onEndStep}
				onUndo={onUndo}
				onRedo={onRedo}
				onCaretClick={(offset) => {
					// The innermost element under the caret, as in Figma's click-to-select
					const start = elementAt(parseJsx(source), offset)?.start ?? null;

					if (start !== null) pick(start, false);
					else if (node) select(null);
				}}
			/>
		</div>
	);
}

/** Inline name for "Make component", prefilled with a guess from the structure. */
function NameField({
	source,
	start,
	onSubmit,
	onCancel,
}: {
	source: string;
	start: number;
	onSubmit: (name: string) => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState(() => {
		const element = findElement(parseJsx(source), start);

		const icons = new Set(
			readImports(source)
				.filter((d) => d.module === "lucide-react")
				.flatMap((d) => d.named.map((s) => s.local)),
		);

		return element ? suggestName(element, icons) : "";
	});

	return (
		<form
			className="flex shrink-0 items-center gap-1.5 border-b bg-muted/40 px-3 py-2"
			onSubmit={(event) => {
				event.preventDefault();

				if (name.trim()) onSubmit(name);
			}}
		>
			<Component className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
			<input
				autoFocus
				value={name}
				onChange={(event) => setName(event.target.value)}
				onFocus={(event) => event.currentTarget.select()}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
					} else if (isMakeComponent(event)) event.preventDefault();
				}}
				aria-label="Component name"
				placeholder="Component name"
				className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-[13px] outline-none placeholder:text-subtle-foreground focus:border-ring"
			/>
			<Button type="submit" size="xs" className="h-7" disabled={!name.trim()}>
				Make
			</Button>
			<Button type="button" variant="ghost" size="xs" className="h-7 text-muted-foreground" onClick={onCancel}>
				Cancel
			</Button>
		</form>
	);
}

/** Drag or arrow keys resize the structure pane. */
function Divider({
	height,
	onHeightChange,
	container,
}: {
	height: number;
	onHeightChange: (height: number) => void;
	container: React.RefObject<HTMLDivElement | null>;
}) {
	const max = () => Math.max(MIN_HEIGHT, (container.current?.clientHeight ?? 600) - 120);
	const clamp = (value: number) => Math.round(Math.min(max(), Math.max(MIN_HEIGHT, value)));

	return (
		<div
			role="separator"
			aria-orientation="horizontal"
			aria-label="Resize structure"
			aria-valuenow={height}
			aria-valuemin={MIN_HEIGHT}
			tabIndex={0}
			onPointerDown={(event) => {
				event.preventDefault();
				const from = event.clientY;
				const start = height;
				const target = event.currentTarget;
				target.setPointerCapture(event.pointerId);
				const move = (e: PointerEvent) => onHeightChange(clamp(start + e.clientY - from));

				const up = () => {
					target.removeEventListener("pointermove", move);
					target.removeEventListener("pointerup", up);
				};

				target.addEventListener("pointermove", move);
				target.addEventListener("pointerup", up);
			}}
			onKeyDown={(event) => {
				if (event.key === "ArrowUp" || event.key === "ArrowDown") {
					event.preventDefault();
					onHeightChange(clamp(height + (event.key === "ArrowDown" ? 1 : -1) * (event.shiftKey ? 80 : 20)));
				}
			}}
			className="relative h-px shrink-0 cursor-row-resize bg-border outline-none after:absolute after:inset-x-0 after:-top-1 after:-bottom-1 after:content-[''] hover:bg-ring/60 focus-visible:bg-ring"
		/>
	);
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

/**
 * The JSX tree as a keyboard-navigable tree: ↑/↓ move, ←/→ collapse and
 * expand (or go to the parent / first child), Enter makes a component,
 * ⌫ deletes the element (undoable).
 */
function StructureTree({
	treeRef,
	roots,
	stale,
	selectedStart,
	ancestors,
	onSelect,
	onMake,
	onDelete,
}: {
	treeRef: React.RefObject<HTMLDivElement | null>;
	roots: OutlineNode[];
	stale: boolean;
	selectedStart: number | null;
	ancestors: OutlineNode[];
	onSelect: (start: number) => void;
	onMake: () => void;
	onDelete: () => void;
}) {
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
	// A selection made elsewhere (code click, make component) opens its ancestors and scrolls into view
	const ancestorKeys = ancestors.map((a) => a.key).join(" ");
	const [openedFor, setOpenedFor] = useState("");

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
				if (row) {
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

	return (
		<div
			ref={treeRef}
			role="tree"
			aria-label="Structure"
			aria-activedescendant={selectedRow ? `outline-${selectedRow.key}` : undefined}
			tabIndex={0}
			onKeyDown={onKeyDown}
			className={cn("py-1 outline-none focus-visible:bg-accent/30", stale && "pointer-events-none opacity-50")}
		>
			{rows.map((row) => {
				const chip = contextChip(row);
				const isSelected = row === selectedRow;
				const hasChildren = row.children.length > 0;
				const isComponent = row.kind === "component";

				return (
					<div
						key={row.key}
						id={`outline-${row.key}`}
						data-key={row.key}
						role="treeitem"
						aria-level={row.depth - minDepth + 1}
						aria-selected={isSelected}
						aria-expanded={hasChildren ? !collapsed.has(row.key) : undefined}
						onClick={() => {
							onSelect(row.start);
							treeRef.current?.focus();
						}}
						onDoubleClick={() => hasChildren && toggle(row.key)}
						className={cn(
							"flex h-6 cursor-default items-center gap-1 pr-3 text-xs select-none hover:bg-accent/60",
							isSelected && "bg-accent hover:bg-accent",
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
}
