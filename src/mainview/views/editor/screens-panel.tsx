import { memo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { ScreenFrame } from "@/components/app/screen-preview";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { matchesScreen, stepTarget } from "@/lib/screen-list";
import { cn } from "@/lib/utils";
import { isString } from "../../../shared/guards";
import type { Frame, ProjectFiles } from "../../../shared/types";

/** Rows dragged within the list; the canvas and the composer ignore this type */
const DRAG_TYPE = "application/x-rabisco-screens";

const THUMB = { width: 44, height: 36 };

type ScreensPanelProps = {
	frames: Frame[];
	files: ProjectFiles;
	selection: string[];
	/** `additive` with ⇧ */
	onSelect: (file: string, additive: boolean) => void;
	/** Right-click on a row: select it unless it is already in the selection */
	onContextSelect: (file: string) => void;
	/** Items of a row's right-click menu, which acts on the selection */
	screenMenu: () => React.ReactNode;
	/** One undo step */
	onRename: (file: string, name: string) => void;
	/** Moves `files` in front of `before`, or to the end; one undo step */
	onReorder: (files: string[], before: string | null) => void;
};

type DropMark = { file: string; after: boolean };

/** Every screen, with a thumbnail: search, rename in place and drag to reorder */
export const ScreensPanel = memo(function ScreensPanel({
	frames,
	files,
	selection,
	onSelect,
	onContextSelect,
	screenMenu,
	onRename,
	onReorder,
}: ScreensPanelProps) {
	const [query, setQuery] = useState("");
	const [renaming, setRenaming] = useState<string | null>(null);
	const [drop, setDrop] = useState<DropMark | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const selected = new Set(selection);
	const shown = frames.filter((frame) => matchesScreen(frame, query));

	/** The selection moves together when the row is part of it */
	const movingWith = (file: string) =>
		selected.has(file) ? frames.flatMap((frame) => (selected.has(frame.file) ? [frame.file] : [])) : [file];

	const dropMark = (event: DragEvent<HTMLElement>, file: string): DropMark => {
		const box = event.currentTarget.getBoundingClientRect();

		return { file, after: event.clientY > box.top + box.height / 2 };
	};

	const dropOn = (mark: DropMark, moving: string[]) => {
		if (!mark.after) return onReorder(moving, mark.file);
		const at = frames.findIndex((frame) => frame.file === mark.file);
		const next = frames.slice(at + 1).find((frame) => !moving.includes(frame.file));
		onReorder(moving, next?.file ?? null);
	};

	const focusRow = (from: HTMLElement, step: -1 | 1) => {
		const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-screen-row]") ?? [])];
		rows[rows.indexOf(from) + step]?.focus();
	};

	const rowKeys = (event: KeyboardEvent<HTMLButtonElement>, file: string) => {
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
		event.preventDefault();
		const direction = event.key === "ArrowUp" ? -1 : 1;

		// ⌥↑ and ⌥↓ move the row, as in a layers list; plain arrows move the focus
		if (!event.altKey) return focusRow(event.currentTarget, direction);
		const moving = movingWith(file);
		const before = stepTarget(frames, moving, direction);

		if (before !== undefined) onReorder(moving, before);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center gap-1.5 border-b px-3">
				<Search className="size-3.5 shrink-0 text-subtle-foreground" />
				<input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => event.key === "Escape" && (query ? setQuery("") : event.currentTarget.blur())}
					placeholder="Search screens"
					aria-label="Search screens"
					className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle-foreground"
				/>
				{query ? (
					<button
						type="button"
						onClick={() => setQuery("")}
						aria-label="Clear the search"
						className="grid size-5 place-items-center rounded-sm text-subtle-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
					>
						<X className="size-3.5" />
					</button>
				) : null}
			</div>
			<div
				ref={listRef}
				role="list"
				aria-label="Screens"
				className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2"
				onDragLeave={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null))
						setDrop(null);
				}}
			>
				{frames.length === 0 ? (
					<p className="px-2 py-1 text-[13px] text-subtle-foreground">No screens yet.</p>
				) : shown.length === 0 ? (
					<p className="px-2 py-1 text-[13px] text-subtle-foreground">No screens match “{query.trim()}”.</p>
				) : (
					shown.map((frame) => (
						<ScreenRow
							key={frame.file}
							frame={frame}
							files={files}
							selected={selected.has(frame.file)}
							renaming={renaming === frame.file}
							drop={drop?.file === frame.file ? (drop.after ? "after" : "before") : null}
							onSelect={onSelect}
							onContextSelect={onContextSelect}
							screenMenu={screenMenu}
							onStartRename={() => setRenaming(frame.file)}
							onRename={(name) => {
								setRenaming(null);

								if (name.trim() && name.trim() !== frame.name) onRename(frame.file, name.trim());
							}}
							onKeyDown={(event) => rowKeys(event, frame.file)}
							onDragStart={(event) => {
								event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(movingWith(frame.file)));
								event.dataTransfer.effectAllowed = "move";
							}}
							onDragOver={(event) => {
								if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
								event.preventDefault();
								event.dataTransfer.dropEffect = "move";
								const mark = dropMark(event, frame.file);

								if (drop?.file !== mark.file || drop.after !== mark.after) setDrop(mark);
							}}
							onDrop={(event) => {
								setDrop(null);
								const moving = parseMoving(event.dataTransfer.getData(DRAG_TYPE));

								if (!moving) return;
								event.preventDefault();
								dropOn(dropMark(event, frame.file), moving);
							}}
							onDragEnd={() => setDrop(null)}
						/>
					))
				)}
			</div>
		</div>
	);
});

function parseMoving(data: string): string[] | null {
	try {
		const value: unknown = JSON.parse(data);

		return Array.isArray(value) && value.every(isString) ? value : null;
	} catch {
		return null;
	}
}

function ScreenRow({
	frame,
	files,
	selected,
	renaming,
	drop,
	onSelect,
	onContextSelect,
	screenMenu,
	onStartRename,
	onRename,
	onKeyDown,
	onDragStart,
	onDragOver,
	onDrop,
	onDragEnd,
}: {
	frame: Frame;
	files: ProjectFiles;
	selected: boolean;
	renaming: boolean;
	drop: "before" | "after" | null;
	onSelect: ScreensPanelProps["onSelect"];
	onContextSelect: ScreensPanelProps["onContextSelect"];
	screenMenu: ScreensPanelProps["screenMenu"];
	onStartRename: () => void;
	onRename: (name: string) => void;
	onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
	onDragStart: (event: DragEvent<HTMLElement>) => void;
	onDragOver: (event: DragEvent<HTMLElement>) => void;
	onDrop: (event: DragEvent<HTMLElement>) => void;
	onDragEnd: () => void;
}) {
	const scale = Math.min(THUMB.width / frame.width, THUMB.height / frame.height);

	return (
		<div
			role="listitem"
			className={cn(
				"relative",
				drop &&
					"before:absolute before:inset-x-1 before:z-10 before:h-0.5 before:rounded-full before:bg-ring before:content-['']",
				drop === "before" && "before:-top-px",
				drop === "after" && "before:-bottom-px",
			)}
			onDragOver={onDragOver}
			onDrop={onDrop}
		>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						type="button"
						data-screen-row=""
						title={frame.file}
						draggable={!renaming}
						onDragStart={onDragStart}
						onDragEnd={onDragEnd}
						onClick={(event) => onSelect(frame.file, event.shiftKey)}
						onDoubleClick={onStartRename}
						onContextMenu={() => onContextSelect(frame.file)}
						onKeyDown={onKeyDown}
						aria-current={selected || undefined}
						className={cn(
							"flex h-12 w-full items-center gap-2.5 rounded-md px-1.5 text-left text-[13px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent",
							selected && "bg-accent font-medium text-accent-foreground",
						)}
					>
						<span
							className="grid shrink-0 place-items-center"
							style={{ width: THUMB.width, height: THUMB.height }}
							aria-hidden
						>
							<span
								className="overflow-hidden rounded-[3px] bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.08)]"
								style={{ width: frame.width * scale, height: frame.height * scale }}
							>
								<span className="block origin-top-left" style={{ transform: `scale(${scale})` }}>
									<ScreenFrame
										entry={frame.file}
										files={files}
										width={frame.width}
										height={frame.height}
										live={false}
									/>
								</span>
							</span>
						</span>
						{renaming ? null : <span className="min-w-0 flex-1 truncate">{frame.name}</span>}
					</button>
				</ContextMenuTrigger>
				{/* Rename focuses the name field, which focus going back to the row would undo */}
				<ContextMenuContent className="w-52" onCloseAutoFocus={(event) => event.preventDefault()}>
					{screenMenu()}
				</ContextMenuContent>
			</ContextMenu>
			{renaming ? (
				<input
					// Over the row's name, so the row keeps its layout
					autoFocus
					defaultValue={frame.name}
					onFocus={(event) => event.currentTarget.select()}
					onBlur={(event) => onRename(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") event.currentTarget.blur();
						else if (event.key === "Escape") {
							event.currentTarget.value = frame.name;
							event.currentTarget.blur();
						}
					}}
					aria-label="Screen name"
					className="absolute inset-y-2 right-1.5 h-8 rounded-md border bg-background px-2 text-[13px] outline-none focus:border-ring"
					style={{ left: THUMB.width + 16 }}
				/>
			) : null}
		</div>
	);
}
