import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Component, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Structure } from "@/hooks/use-structure";
import { findNode } from "@/lib/outline";
import { cn } from "@/lib/utils";
import { elementAt, findElement, parseJsx, readImports, suggestName } from "../../../shared/jsx";
import { isBoolean, isNumber } from "../../../shared/guards";
import { CodeEditor, CodeHeader } from "./code-view";
import { CODE_VIEW_KEYS, isMakeComponent, MAKE_COMPONENT_KEYS } from "./shortcuts";
import { StructureTree, useOutline } from "./structure-tree";

type CodePanelProps = {
	path: string | null;
	source: string | undefined;
	emptyMessage: string;
	structure: Structure;
	onEndStep: () => void;
	onUndo: () => void;
	onRedo: () => void;
	onShowProps: () => void;
	/** Items of the right-click menu on a row, which it selects first */
	elementMenu?: () => React.ReactNode;
	/** Bumped to scroll the code to the selected element */
	revealKey?: number;
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

export const CodePanel = memo(function CodePanel(props: CodePanelProps) {
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
});

function FileCode({
	path,
	source,
	structure,
	onEndStep,
	onUndo,
	onRedo,
	onShowProps,
	elementMenu,
	revealKey: revealRequest = 0,
}: CodePanelProps & { path: string; source: string }) {
	const { node, select, busy, naming, setNaming, makeComponent, editCode } = structure;
	const [open, setOpen] = useState(() => stored(OPEN_KEY, true, isBoolean));
	const [height, setHeight] = useState(() => stored(HEIGHT_KEY, DEFAULT_HEIGHT, isNumber));
	const [revealKey, setRevealKey] = useState(0);
	const tree = useRef<HTMLDivElement>(null);
	const container = useRef<HTMLDivElement>(null);

	const { outline, shown, stale } = useOutline(path, source);

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
								file={path}
								roots={shown.roots}
								stale={stale}
								selectedStart={selected?.node.start ?? null}
								ancestors={selected?.ancestors ?? []}
								onSelect={(start) => pick(start, true)}
								onMake={startNaming}
								onDelete={structure.removeNode}
								menu={elementMenu}
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
				revealKey={revealKey + revealRequest}
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

	// After the commit rather than in it (`autoFocus`): a menu that opened this still traps focus until then
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => input.current?.focus(), []);

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
				ref={input}
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
