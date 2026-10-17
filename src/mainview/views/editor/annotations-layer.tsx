import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { HANDLE_CURSOR, HANDLES, handleSides, handleSpan, resizeRect, type Handle } from "@/lib/frame-resize";
import { formatChord } from "@/lib/actions";
import { cn } from "@/lib/utils";
import type { ViewportStore } from "@/lib/viewport";
import {
	annotationBounds,
	MIN_ARROW_LENGTH,
	MIN_NOTE_SIZE,
	moveAnnotation,
	NOTE_SIZE,
	snapAngle,
} from "../../../shared/annotations";
import { SECTION_COLORS } from "../../../shared/sections";
import type { Annotation, CanvasArrow, CanvasNote, SectionColor } from "../../../shared/types";
import { COLOR_NAMES } from "./sections-layer";

const DRAG_THRESHOLD = 3;

/** Canvas units around an arrow's line, so its head and hit area fit in its box */
const ARROW_PAD = 24;

const DEFAULT_ARROW = 160;

const NOTE_FILL: Record<SectionColor, string> = {
	gray: "var(--color-neutral-200)",
	red: "var(--color-red-200)",
	orange: "var(--color-orange-200)",
	yellow: "var(--color-yellow-200)",
	green: "var(--color-green-200)",
	blue: "var(--color-blue-200)",
	purple: "var(--color-purple-200)",
	pink: "var(--color-pink-200)",
};

const SELECTED_RING = "0 0 0 calc(2px * var(--unzoom)) var(--primary)";

const NOTE_SHADOW = "0 1px 2px rgb(0 0 0 / 0.08), 0 6px 16px -6px rgb(0 0 0 / 0.18)";

type Rect = { x: number; y: number; width: number; height: number };

type Point = { x: number; y: number };

type Ends = { x1: number; y1: number; x2: number; y2: number };

type Drag =
	| { kind: "move"; id: string; dragId: string; startX: number; startY: number; moved: boolean }
	| { kind: "resize"; id: string; handle: Handle; startX: number; startY: number; origin: Rect }
	| { kind: "end"; id: string; end: "start" | "end"; startX: number; startY: number; origin: Ends };

type Preview = { id: string; annotation: Annotation };

type LayerProps = {
	annotations: Annotation[];
	viewport: ViewportStore;
	selectedId: string | null;
	editing: string | null;
	interactive: boolean;
	onSelect: (id: string) => void;
	onStartEditing: (id: string) => void;
	onText: (id: string, text: string) => void;
	onMove: (id: string, dx: number, dy: number, dragId: string) => void;
	onMoveEnd: () => void;
	onResize: (id: string, rect: Rect) => void;
	onMoveEnds: (id: string, ends: Ends) => void;
	onRecolor: (id: string, color: SectionColor) => void;
	onDuplicate: (id: string) => void;
	onDelete: (id: string) => void;
};

const DELETE_KEYS = "⌫";

const DUPLICATE_KEYS = formatChord({ code: "KeyD", mod: true });

export function AnnotationsLayer(props: LayerProps) {
	const { annotations, viewport, onMove, onMoveEnd, onResize, onMoveEnds } = props;
	const drag = useRef<Drag | null>(null);
	const [preview, setPreview] = useState<Preview | null>(null);

	const delta = (event: React.PointerEvent, current: Drag) => {
		const { zoom } = viewport.get();

		return { dx: (event.clientX - current.startX) / zoom, dy: (event.clientY - current.startY) / zoom };
	};

	const changed = (event: React.PointerEvent, current: Drag, source: Annotation): Annotation | null => {
		const { dx, dy } = delta(event, current);

		if (current.kind === "move") {
			if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_THRESHOLD)
				return null;
			current.moved = true;

			return moveAnnotation(source, Math.round(dx), Math.round(dy));
		}

		if (current.kind === "resize" && source.kind === "note") {
			const rect = resizeRect(current.origin, current.handle, dx, dy, {
				keepRatio: event.shiftKey,
				fromCenter: event.altKey,
				maxSize: Infinity,
			});

			return {
				...source,
				...rect,
				width: Math.max(MIN_NOTE_SIZE, rect.width),
				height: Math.max(MIN_NOTE_SIZE, rect.height),
			};
		}

		if (current.kind === "end" && source.kind === "arrow") {
			const { origin } = current;
			const fixed = current.end === "start" ? { x: origin.x2, y: origin.y2 } : { x: origin.x1, y: origin.y1 };

			const moving =
				current.end === "start" ? { x: origin.x1 + dx, y: origin.y1 + dy } : { x: origin.x2 + dx, y: origin.y2 + dy };

			const point = event.shiftKey ? snapAngle(fixed, moving) : { x: Math.round(moving.x), y: Math.round(moving.y) };

			return current.end === "start"
				? { ...source, x1: point.x, y1: point.y }
				: { ...source, x2: point.x, y2: point.y };
		}

		return null;
	};

	const press = (event: React.PointerEvent, next: Drag) => {
		if (event.button !== 0) return false;
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = next;

		return true;
	};

	const onPointerMove = (event: React.PointerEvent) => {
		const current = drag.current;
		const source = current && annotations.find((annotation) => annotation.id === current.id);

		if (!current || !source) return;
		event.stopPropagation();
		const next = changed(event, current, source);

		if (next) setPreview({ id: source.id, annotation: next });
	};

	const onPointerUp = (event: React.PointerEvent) => {
		const current = drag.current;
		const source = current && annotations.find((annotation) => annotation.id === current.id);

		drag.current = null;
		setPreview(null);

		if (!current || !source) return;
		event.stopPropagation();
		const next = changed(event, current, source);

		if (!next) return;

		if (current.kind === "move") {
			const { dx, dy } = delta(event, current);
			onMove(current.id, Math.round(dx), Math.round(dy), current.dragId);
			onMoveEnd();
		} else if (next.kind === "note")
			onResize(next.id, { x: next.x, y: next.y, width: next.width, height: next.height });
		else if (Math.hypot(next.x2 - next.x1, next.y2 - next.y1) >= MIN_ARROW_LENGTH)
			onMoveEnds(next.id, { x1: next.x1, y1: next.y1, x2: next.x2, y2: next.y2 });
	};

	const handlers = { onPointerMove, onPointerUp, onPointerCancel: onPointerUp };

	const startMove = (event: React.PointerEvent, annotation: Annotation) => {
		const next: Drag = {
			kind: "move",
			id: annotation.id,
			dragId: crypto.randomUUID(),
			startX: event.clientX,
			startY: event.clientY,
			moved: false,
		};

		if (press(event, next)) props.onSelect(annotation.id);
	};

	const startResize = (event: React.PointerEvent, note: CanvasNote, handle: Handle) => {
		const origin = { x: note.x, y: note.y, width: note.width, height: note.height };
		press(event, { kind: "resize", id: note.id, handle, startX: event.clientX, startY: event.clientY, origin });
	};

	const startEnd = (event: React.PointerEvent, arrow: CanvasArrow, end: "start" | "end") => {
		const origin = { x1: arrow.x1, y1: arrow.y1, x2: arrow.x2, y2: arrow.y2 };
		press(event, { kind: "end", id: arrow.id, end, startX: event.clientX, startY: event.clientY, origin });
	};

	return (
		<div data-annotations-layer className="contents">
			{annotations.map((annotation) => {
				const shown = preview?.id === annotation.id ? preview.annotation : annotation;

				return shown.kind === "note" ? (
					<Note
						key={annotation.id}
						note={shown}
						{...props}
						handlers={handlers}
						onPress={startMove}
						onPressHandle={startResize}
					/>
				) : (
					<Arrow
						key={annotation.id}
						arrow={shown}
						{...props}
						handlers={handlers}
						onPress={startMove}
						onPressEnd={startEnd}
					/>
				);
			})}
		</div>
	);
}

type Handlers = {
	onPointerMove: (event: React.PointerEvent) => void;
	onPointerUp: (event: React.PointerEvent) => void;
	onPointerCancel: (event: React.PointerEvent) => void;
};

type ItemProps = LayerProps & {
	handlers: Handlers;
	onPress: (event: React.PointerEvent, annotation: Annotation) => void;
};

function Note({
	note,
	selectedId,
	editing,
	interactive,
	handlers,
	onPress,
	onPressHandle,
	...props
}: ItemProps & {
	note: CanvasNote;
	onPressHandle: (event: React.PointerEvent, note: CanvasNote, handle: Handle) => void;
}) {
	const selected = selectedId === note.id;
	const writing = editing === note.id;

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild disabled={!interactive || writing}>
				<div
					data-annotation={note.id}
					role="note"
					aria-label={note.text ? `Sticky note: ${note.text}` : "Empty sticky note"}
					className={cn(
						"absolute rounded-[2px] p-4 text-[18px]/[1.4] text-neutral-900",
						interactive ? "pointer-events-auto" : "pointer-events-none",
					)}
					style={{
						left: note.x,
						top: note.y,
						width: note.width,
						height: note.height,
						background: NOTE_FILL[note.color],
						boxShadow: selected ? `${SELECTED_RING}, ${NOTE_SHADOW}` : NOTE_SHADOW,
					}}
					onPointerDown={(event) => !writing && onPress(event, note)}
					onDoubleClick={(event) => {
						event.stopPropagation();
						props.onStartEditing(note.id);
					}}
					{...handlers}
				>
					{writing ? (
						<NoteEditor note={note} onDone={(text) => props.onText(note.id, text)} />
					) : (
						<p className="size-full overflow-hidden break-words whitespace-pre-wrap select-none">{note.text}</p>
					)}
					{selected && interactive && !writing
						? HANDLES.map((handle) => {
								const sides = handleSides(handle);

								if (!sides.x || !sides.y) return null;
								const x = handleSpan(sides.x);
								const y = handleSpan(sides.y);

								return (
									<div
										key={handle}
										className={cn("absolute", HANDLE_CURSOR[handle])}
										style={{ left: x.start, width: x.length, top: y.start, height: y.length }}
										onPointerDown={(event) => onPressHandle(event, note, handle)}
										{...handlers}
									>
										<HandleDot />
									</div>
								);
							})
						: null}
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => props.onStartEditing(note.id)}>
					Edit text
					<ContextMenuShortcut>↵</ContextMenuShortcut>
				</ContextMenuItem>
				<ContextMenuSub>
					<ContextMenuSubTrigger>Color</ContextMenuSubTrigger>
					<ContextMenuSubContent>
						{SECTION_COLORS.map((color) => (
							<ContextMenuItem key={color} onSelect={() => props.onRecolor(note.id, color)}>
								<span className="size-3 rounded-full border border-black/10" style={{ background: NOTE_FILL[color] }} />
								{COLOR_NAMES[color]}
								{color === note.color ? <Check className="ml-auto" /> : null}
							</ContextMenuItem>
						))}
					</ContextMenuSubContent>
				</ContextMenuSub>
				<ContextMenuItem onSelect={() => props.onDuplicate(note.id)}>
					Duplicate
					<ContextMenuShortcut>{DUPLICATE_KEYS}</ContextMenuShortcut>
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem variant="destructive" onSelect={() => props.onDelete(note.id)}>
					Delete note
					<ContextMenuShortcut>{DELETE_KEYS}</ContextMenuShortcut>
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function NoteEditor({ note, onDone }: { note: CanvasNote; onDone: (text: string) => void }) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const done = useRef(false);

	useEffect(() => {
		const area = ref.current;

		if (!area) return;
		area.focus();
		area.setSelectionRange(area.value.length, area.value.length);
	}, []);

	const finish = (text: string) => {
		if (done.current) return;
		done.current = true;
		onDone(text);
	};

	return (
		<textarea
			ref={ref}
			defaultValue={note.text}
			aria-label="Note text"
			placeholder="Write a note"
			className="size-full resize-none bg-transparent outline-none placeholder:text-neutral-900/40"
			onPointerDown={(event) => event.stopPropagation()}
			onBlur={(event) => finish(event.currentTarget.value)}
			onKeyDown={(event) => {
				event.stopPropagation();

				if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
					event.preventDefault();
					finish(event.currentTarget.value);
				}
			}}
		/>
	);
}

function Arrow({
	arrow,
	selectedId,
	interactive,
	handlers,
	onPress,
	onPressEnd,
	...props
}: ItemProps & {
	arrow: CanvasArrow;
	onPressEnd: (event: React.PointerEvent, arrow: CanvasArrow, end: "start" | "end") => void;
}) {
	const selected = selectedId === arrow.id;
	const bounds = annotationBounds(arrow);
	const left = bounds.x - ARROW_PAD;
	const top = bounds.y - ARROW_PAD;
	const line = { x1: arrow.x1 - left, y1: arrow.y1 - top, x2: arrow.x2 - left, y2: arrow.y2 - top };

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild disabled={!interactive}>
				<svg
					data-annotation={arrow.id}
					role="img"
					aria-label="Arrow"
					className={cn("pointer-events-none absolute overflow-visible", selected ? "text-primary" : "text-foreground")}
					style={{ left, top, width: bounds.width + ARROW_PAD * 2, height: bounds.height + ARROW_PAD * 2 }}
				>
					<line
						{...line}
						stroke="transparent"
						strokeLinecap="round"
						className="cursor-move"
						style={{
							pointerEvents: interactive ? "stroke" : "none",
							strokeWidth: "max(16px, calc(14px * var(--unzoom)))",
						}}
						onPointerDown={(event) => onPress(event, arrow)}
						{...handlers}
					/>
					<ArrowLine {...line} width="max(4px, calc(2px * var(--unzoom)))" scale="max(1, calc(var(--unzoom) / 2))" />
				</svg>
			</ContextMenuTrigger>
			{selected && interactive
				? (["start", "end"] as const).map((end) => (
						<div
							key={end}
							aria-hidden
							className="pointer-events-auto absolute cursor-crosshair"
							style={{
								left: end === "start" ? arrow.x1 : arrow.x2,
								top: end === "start" ? arrow.y1 : arrow.y2,
								width: "calc(14px * var(--unzoom))",
								height: "calc(14px * var(--unzoom))",
								translate: "-50% -50%",
							}}
							onPointerDown={(event) => onPressEnd(event, arrow, end)}
							{...handlers}
						>
							<HandleDot round />
						</div>
					))
				: null}
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => props.onDuplicate(arrow.id)}>
					Duplicate
					<ContextMenuShortcut>{DUPLICATE_KEYS}</ContextMenuShortcut>
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem variant="destructive" onSelect={() => props.onDelete(arrow.id)}>
					Delete arrow
					<ContextMenuShortcut>{DELETE_KEYS}</ContextMenuShortcut>
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

/** Canvas units of the shaft hidden under the head, so the line's end doesn't show past it */
const HEAD_OVERLAP = 10;

/** The head is drawn for a 4px line; `scale` grows it with the line when zoomed out */
function ArrowLine({ x1, y1, x2, y2, width, scale }: Ends & { width: string; scale: string }) {
	const length = Math.hypot(x2 - x1, y2 - y1);
	const angle = Math.atan2(y2 - y1, x2 - x1);
	const cut = length > HEAD_OVERLAP ? HEAD_OVERLAP / length : 0;

	return (
		<>
			<line
				x1={x1}
				y1={y1}
				x2={x2 - (x2 - x1) * cut}
				y2={y2 - (y2 - y1) * cut}
				stroke="currentColor"
				strokeLinecap="round"
				style={{ strokeWidth: width }}
			/>
			<path
				d="M0 0L-20 -10L-20 10z"
				fill="currentColor"
				style={{ transform: `translate(${x2}px, ${y2}px) rotate(${angle}rad) scale(${scale})` }}
			/>
		</>
	);
}

function HandleDot({ round }: { round?: boolean }) {
	return (
		<span
			className={cn(
				"absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border-primary bg-background",
				round ? "rounded-full" : "rounded-[1px]",
			)}
			style={{
				width: "calc(8px * var(--unzoom))",
				height: "calc(8px * var(--unzoom))",
				borderWidth: "calc(1px * var(--unzoom))",
			}}
		/>
	);
}

type DrawProps = {
	kind: Annotation["kind"];
	viewport: ViewportStore;
	onNote: (rect: Rect) => void;
	onArrow: (from: Point, to: Point) => void;
	onCancel: () => void;
};

/** Click for a default note or arrow, or drag to size it; ⇧ snaps an arrow to 45° */
export function AnnotationDraw({ kind, viewport, onNote, onArrow, onCancel }: DrawProps) {
	const [box, setBox] = useState<{ start: Point; current: Point; snap: boolean } | null>(null);

	const local = (event: React.PointerEvent): Point => {
		const rect = event.currentTarget.getBoundingClientRect();

		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	};

	const toCanvas = (point: Point): Point => {
		const { x, y, zoom } = viewport.get();

		return { x: Math.round((point.x - x) / zoom), y: Math.round((point.y - y) / zoom) };
	};

	const finish = (event: React.PointerEvent) => {
		if (!box) return;
		setBox(null);
		const end = local(event);
		const clicked = Math.hypot(end.x - box.start.x, end.y - box.start.y) < DRAG_THRESHOLD;
		const a = toCanvas(box.start);
		const b = toCanvas(end);

		if (kind === "arrow") {
			if (clicked) return onArrow(a, { x: a.x + DEFAULT_ARROW, y: a.y });

			return onArrow(a, event.shiftKey ? snapAngle(a, b) : b);
		}

		if (clicked) return onNote({ x: a.x - NOTE_SIZE.width / 2, y: a.y - NOTE_SIZE.height / 2, ...NOTE_SIZE });

		onNote({
			x: Math.min(a.x, b.x),
			y: Math.min(a.y, b.y),
			width: Math.max(MIN_NOTE_SIZE, Math.abs(b.x - a.x)),
			height: Math.max(MIN_NOTE_SIZE, Math.abs(b.y - a.y)),
		});
	};

	const tip = box && kind === "arrow" && box.snap ? snapAngle(box.start, box.current) : box?.current;

	return (
		<div
			className="absolute inset-0 cursor-crosshair"
			onPointerDown={(event) => {
				if (event.button !== 0) return onCancel();
				event.stopPropagation();
				event.currentTarget.setPointerCapture(event.pointerId);
				const point = local(event);
				setBox({ start: point, current: point, snap: event.shiftKey });
			}}
			onPointerMove={(event) => box && setBox({ ...box, current: local(event), snap: event.shiftKey })}
			onPointerUp={finish}
			onPointerCancel={() => setBox(null)}
			onContextMenu={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onCancel();
			}}
		>
			{box && tip && kind === "arrow" ? (
				<svg aria-hidden className="pointer-events-none absolute inset-0 size-full text-primary">
					<ArrowLine x1={box.start.x} y1={box.start.y} x2={tip.x} y2={tip.y} width="2px" scale="0.6" />
				</svg>
			) : null}
			{box && kind === "note" ? (
				<div
					className="pointer-events-none absolute rounded-[2px] border border-primary"
					style={{
						left: Math.min(box.start.x, box.current.x),
						top: Math.min(box.start.y, box.current.y),
						width: Math.abs(box.current.x - box.start.x),
						height: Math.abs(box.current.y - box.start.y),
						background: "color-mix(in oklab, var(--color-yellow-200) 60%, transparent)",
					}}
				/>
			) : null}
		</div>
	);
}
