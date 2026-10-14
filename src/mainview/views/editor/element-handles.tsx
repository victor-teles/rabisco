import { useCallback, useEffect, useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Box } from "@/lib/render/protocol";
import type { ElementLayout, Insets, Spacing } from "@/lib/render/spacing";
import {
	draggedGap,
	draggedPadding,
	gapLabel,
	gapPartOf,
	gapParts,
	gapPreview,
	handleDimensions,
	handlePosition,
	paddingLabel,
	paddingPreview,
	paddingSides,
	RESIZE_HANDLES,
	resizedSize,
	setFixedSize,
	setGap,
	setPadding,
	setSizeMode,
	sizeLabel,
	sizeMode,
	sizePreview,
	spacingPixels,
	spacingValue,
	type Dimension,
	type GapPart,
	type PreviewStyle,
	type ResizeHandle,
	type Side,
	type SizeMode,
} from "@/lib/resize";
import { ChromePortal, zoomed } from "./chrome-layer";

type Point = { x: number; y: number };

/** What a drag would write so far */
type Pending = { label: string; preview: PreviewStyle; edit: (classes: string) => string };

type HandleDrag =
	| { kind: "size"; handle: ResizeHandle; start: { width: number; height: number } }
	| { kind: "padding"; side: Side; start: Insets }
	| { kind: "gap"; part: GapPart; start: number };

type Dragging = HandleDrag & { origin: Point; pending: Pending | null };

/** Screen pixels the pointer travels before a press on a handle becomes a drag */
const DRAG_THRESHOLD = 3;

/** Spacing handles crowd an element smaller than this on screen */
const MIN_SPACING_HANDLES = 48;

/** Two presses on one resize handle this close together are a double-click (the capture keeps `dblclick` away) */
const DOUBLE_PRESS_MS = 400;

/** The commit's render restores the preview; this covers a commit that was refused */
const PREVIEW_FALLBACK_MS = 1000;

const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

const MODES: { mode: SizeMode; label: string }[] = [
	{ mode: "fixed", label: "Fixed" },
	{ mode: "hug", label: "Hug contents" },
	{ mode: "fill", label: "Fill container" },
];

const isSizeMode = (value: string): value is SizeMode => MODES.some((item) => item.mode === value);

const CURSORS: Record<ResizeHandle, string> = {
	n: "ns-resize",
	s: "ns-resize",
	e: "ew-resize",
	w: "ew-resize",
	ne: "nesw-resize",
	sw: "nesw-resize",
	nw: "nwse-resize",
	se: "nwse-resize",
};

const samePreview = (a: PreviewStyle | undefined, b: PreviewStyle) => !!a && JSON.stringify(a) === JSON.stringify(b);

const px = (value: number) => String(Math.round(value));

function pending(
	drag: HandleDrag,
	classes: string,
	layout: ElementLayout,
	variant: string,
	delta: Point,
	event: PointerEvent,
): Pending {
	if (drag.kind === "size") {
		const sizes = resizedSize(drag.handle, drag.start, delta);
		const values: Partial<Record<Dimension, string>> = {};
		const snapped: Partial<Record<Dimension, number>> = {};

		for (const dimension of handleDimensions(drag.handle)) {
			const value = spacingValue(sizes[dimension] ?? 0);
			values[dimension] = value;
			snapped[dimension] = spacingPixels(value) ?? 0;
		}

		return {
			label: sizeLabel(values, variant),
			preview: sizePreview(snapped, layout.parent),
			edit: (current) => {
				let next = current;

				for (const dimension of handleDimensions(drag.handle)) {
					const value = values[dimension];

					if (value !== undefined) next = setFixedSize(next, dimension, value, layout.parent, variant);
				}

				return next;
			},
		};
	}

	if (drag.kind === "padding") {
		const sides = paddingSides(drag.side, { all: event.altKey, symmetric: event.shiftKey });
		const value = spacingValue(draggedPadding(drag.side, drag.start, delta));

		return {
			label: paddingLabel(sides, value, variant),
			preview: paddingPreview(sides, spacingPixels(value) ?? 0),
			edit: (current) => setPadding(current, sides, value, variant),
		};
	}

	const parts = gapParts(classes, drag.part, layout.flow, variant);
	const value = spacingValue(draggedGap(drag.part, drag.start, delta));

	return {
		label: gapLabel(classes, parts, value, variant),
		preview: gapPreview(parts, spacingPixels(value) ?? 0),
		edit: (current) => setGap(current, parts, value, variant),
	};
}

type ElementHandlesProps = {
	/** Frame-local, the first instance */
	box: Box;
	frame: Point;
	layout: ElementLayout;
	spacing: Spacing | null;
	/** The element's classes, which the handles can write */
	classes: string;
	variant: string;
	zoom: () => number;
	/** Inline styles on the live frame while a handle drags; `null` restores the element */
	onPreview: (style: PreviewStyle | null) => void;
	/** One undo step */
	onCommit: (edit: (classes: string) => string) => void;
};

/**
 * Resize handles on the edges and corners, padding handles inside each side, gap handles between the children, and
 * the size pill below with Figma's fixed, hug and fill. Drags preview on the live frame and commit once, on release.
 */
export function ElementHandles({
	box,
	frame,
	layout,
	spacing,
	classes,
	variant,
	zoom,
	onPreview,
	onCommit,
}: ElementHandlesProps) {
	const dragging = useRef<Dragging | null>(null);
	const [label, setLabel] = useState<string | null>(null);
	const fallback = useRef(0);
	/** Takes the pointer for the whole drag: the handle that was pressed can go away as it drags (a gap down to 0) */
	const captureRef = useRef<HTMLDivElement>(null);
	const lastPress = useRef<{ handle: ResizeHandle; at: number } | null>(null);
	const latest = useRef({ classes, layout, variant, onPreview, onCommit });

	useEffect(() => {
		latest.current = { classes, layout, variant, onPreview, onCommit };
	});

	const cancel = useCallback(() => {
		if (!dragging.current) return;
		dragging.current = null;
		setLabel(null);
		latest.current.onPreview(null);
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !dragging.current) return;
			// Before the editor's Escape, which would select the parent
			event.preventDefault();
			event.stopPropagation();
			cancel();
		};

		window.addEventListener("keydown", onKey, true);

		return () => {
			window.removeEventListener("keydown", onKey, true);
			clearTimeout(fallback.current);
		};
	}, [cancel]);

	const start = (drag: HandleDrag) => (event: React.PointerEvent) => {
		if (event.button !== 0) return;
		event.stopPropagation();
		event.preventDefault();

		if (drag.kind === "size") {
			const last = lastPress.current;
			const double = last?.handle === drag.handle && event.timeStamp - last.at < DOUBLE_PRESS_MS;
			lastPress.current = double ? null : { handle: drag.handle, at: event.timeStamp };

			if (double) return hug(drag.handle);
		}

		captureRef.current?.setPointerCapture(event.pointerId);
		clearTimeout(fallback.current);
		dragging.current = { ...drag, origin: { x: event.clientX, y: event.clientY }, pending: null };
	};

	const move = (event: React.PointerEvent) => {
		event.stopPropagation();
		const drag = dragging.current;

		if (!drag) return;
		const dx = event.clientX - drag.origin.x;
		const dy = event.clientY - drag.origin.y;

		if (!drag.pending && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
		lastPress.current = null;
		const scale = zoom();
		const { classes: current, layout: shown, variant: state, onPreview: preview } = latest.current;
		const next = pending(drag, current, shown, state, { x: dx / scale, y: dy / scale }, event.nativeEvent);

		// The frame hears about the snapped value only when it changes
		if (!samePreview(drag.pending?.preview, next.preview)) preview(next.preview);
		drag.pending = next;
		setLabel(next.label);
	};

	const end = (event: React.PointerEvent) => {
		event.stopPropagation();
		const drag = dragging.current;
		dragging.current = null;

		if (!drag?.pending) return;
		setLabel(null);
		const { classes: current, onPreview: preview, onCommit: commit } = latest.current;
		const { edit } = drag.pending;

		if (edit(current) === current) return preview(null);
		commit(edit);
		fallback.current = window.setTimeout(() => preview(null), PREVIEW_FALLBACK_MS);
	};

	const handlers = (drag: HandleDrag) => ({ onPointerDown: start(drag) });

	const setMode = (dimension: Dimension, mode: SizeMode) => {
		const rendered = dimension === "width" ? box.width : box.height;
		const edit = (current: string) => setSizeMode(current, dimension, mode, layout.parent, rendered, variant);

		if (edit(classes) !== classes) onCommit(edit);
	};

	/** Double-clicking a handle hugs, as in Figma */
	const hug = (handle: ResizeHandle) => {
		const dimensions = handleDimensions(handle);

		const edit = (current: string) => {
			let next = current;

			for (const dimension of dimensions) next = setSizeMode(next, dimension, "hug", layout.parent, 0, variant);

			return next;
		};

		if (edit(classes) !== classes) onCommit(edit);
	};

	const roomy = Math.min(box.width, box.height) * zoom() >= MIN_SPACING_HANDLES;

	return (
		<>
			<div
				ref={captureRef}
				aria-hidden
				className="pointer-events-auto absolute size-0"
				onPointerMove={move}
				onPointerUp={end}
				onPointerCancel={cancel}
				// After a release the drag is already over; otherwise the pointer was taken away
				onLostPointerCapture={cancel}
				// The canvas would edit the text under the pointer
				onDoubleClick={(event) => event.stopPropagation()}
			/>
			{roomy
				? SIDES.map((side) => (
						<PaddingHandle
							key={side}
							side={side}
							box={box}
							padding={layout.padding}
							{...handlers({ kind: "padding", side, start: layout.padding })}
						/>
					))
				: null}
			{roomy && layout.flow
				? (spacing?.gaps ?? []).map((gap, i) => {
						const part = gapPartOf(gap);

						return (
							<GapHandle
								key={`gap-${i}`}
								gap={gap}
								part={part}
								{...handlers({
									kind: "gap",
									part,
									start: part === "x" ? layout.gap.column : layout.gap.row,
								})}
							/>
						);
					})
				: null}
			{RESIZE_HANDLES.map((handle) => (
				<ResizeGrip
					key={handle}
					handle={handle}
					box={box}
					{...handlers({ kind: "size", handle, start: { width: box.width, height: box.height } })}
				/>
			))}
			<ChromePortal box={{ ...box, x: frame.x + box.x, y: frame.y + box.y }}>
				<div
					className="pointer-events-auto absolute top-full left-1/2 flex -translate-x-1/2 translate-y-1 items-center rounded-[4px] bg-primary font-sans text-[11px]/4 whitespace-nowrap text-primary-foreground tabular-nums"
					onPointerDown={(event) => event.stopPropagation()}
					onDoubleClick={(event) => event.stopPropagation()}
				>
					{label ? (
						<span className="px-1 font-mono">{label}</span>
					) : (
						<>
							{variant ? <span className="pl-1 font-mono opacity-80">{variant}:</span> : null}
							<SizeMenu
								dimension="width"
								mode={sizeMode(classes, "width", layout.parent, variant)}
								size={box.width}
								onChange={setMode}
							/>
							<span className="opacity-80">×</span>
							<SizeMenu
								dimension="height"
								mode={sizeMode(classes, "height", layout.parent, variant)}
								size={box.height}
								onChange={setMode}
							/>
						</>
					)}
				</div>
			</ChromePortal>
		</>
	);
}

type DragHandlers = { onPointerDown: (event: React.PointerEvent) => void };

function ResizeGrip({ handle, box, ...drag }: DragHandlers & { handle: ResizeHandle; box: Box }) {
	const at = handlePosition(handle);
	const corner = handle.length === 2;
	const vertical = handle === "e" || handle === "w";
	// Edges are thin strips between the corners; corners are squares
	const width = corner ? "8px" : vertical ? "6px" : `calc(${zoomed(box.width)} - 12px)`;
	const height = corner ? "8px" : vertical ? `calc(${zoomed(box.height)} - 12px)` : "6px";

	return (
		<div
			aria-hidden
			className={
				corner
					? "pointer-events-auto absolute rounded-[1px] border-primary bg-background"
					: "pointer-events-auto absolute"
			}
			style={{
				left: `calc(${zoomed(box.x + box.width * at.x)} - (${width}) / 2)`,
				top: `calc(${zoomed(box.y + box.height * at.y)} - (${height}) / 2)`,
				width,
				height,
				borderWidth: corner ? 1 : undefined,
				borderStyle: corner ? "solid" : undefined,
				cursor: CURSORS[handle],
			}}
			onDoubleClick={(event) => event.stopPropagation()}
			{...drag}
		/>
	);
}

/** A short bar in the middle of each padding side, at least a few pixels in from the edge */
function PaddingHandle({ side, box, padding, ...drag }: DragHandlers & { side: Side; box: Box; padding: Insets }) {
	const horizontal = side === "top" || side === "bottom";
	const inset = `max(${zoomed(padding[side] / 2)}, 8px)`;

	const position: React.CSSProperties =
		side === "top"
			? { left: zoomed(box.x + box.width / 2), top: `calc(${zoomed(box.y)} + ${inset})` }
			: side === "bottom"
				? { left: zoomed(box.x + box.width / 2), top: `calc(${zoomed(box.y + box.height)} - ${inset})` }
				: side === "left"
					? { left: `calc(${zoomed(box.x)} + ${inset})`, top: zoomed(box.y + box.height / 2) }
					: { left: `calc(${zoomed(box.x + box.width)} - ${inset})`, top: zoomed(box.y + box.height / 2) };

	return (
		<SpacingBar
			horizontal={horizontal}
			cursor={horizontal ? "ns-resize" : "ew-resize"}
			position={position}
			title={`Padding ${side} · ${px(padding[side])}`}
			{...drag}
		/>
	);
}

function GapHandle({ gap, part, ...drag }: DragHandlers & { gap: Box; part: GapPart }) {
	return (
		<SpacingBar
			horizontal={part === "y"}
			cursor={part === "x" ? "ew-resize" : "ns-resize"}
			position={{ left: zoomed(gap.x + gap.width / 2), top: zoomed(gap.y + gap.height / 2) }}
			title="Gap"
			{...drag}
		/>
	);
}

/** Centered on `position`; the hit area is larger than the bar */
function SpacingBar({
	horizontal,
	cursor,
	position,
	title,
	...drag
}: DragHandlers & { horizontal: boolean; cursor: string; position: React.CSSProperties; title: string }) {
	return (
		<div
			className="group/bar pointer-events-auto absolute grid place-items-center"
			style={{
				...position,
				width: horizontal ? 20 : 10,
				height: horizontal ? 10 : 20,
				transform: "translate(-50%, -50%)",
				cursor,
			}}
			title={title}
			onDoubleClick={(event) => event.stopPropagation()}
			{...drag}
		>
			<div
				className="rounded-full bg-primary/70 group-hover/bar:bg-primary"
				style={{ width: horizontal ? 12 : 2, height: horizontal ? 2 : 12 }}
			/>
		</div>
	);
}

function SizeMenu({
	dimension,
	mode,
	size,
	onChange,
}: {
	dimension: Dimension;
	mode: SizeMode;
	size: number;
	onChange: (dimension: Dimension, mode: SizeMode) => void;
}) {
	const text = mode === "fill" ? "Fill" : mode === "hug" ? "Hug" : px(size);

	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger
				className="rounded-[4px] px-1 outline-none hover:bg-primary-foreground/15 focus-visible:bg-primary-foreground/15"
				aria-label={dimension === "width" ? "Width sizing" : "Height sizing"}
			>
				{text}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="center"
				className="w-40"
				onPointerDown={(event) => event.stopPropagation()}
				onDoubleClick={(event) => event.stopPropagation()}
				onCloseAutoFocus={(event) => event.preventDefault()}
			>
				<DropdownMenuLabel className="text-xs text-muted-foreground">
					{dimension === "width" ? "Width" : "Height"}
				</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={mode}
					onValueChange={(value) => {
						if (isSizeMode(value)) onChange(dimension, value);
					}}
				>
					{MODES.map((item) => (
						<DropdownMenuRadioItem key={item.mode} value={item.mode}>
							{item.label}
							{item.mode === "fixed" ? (
								<span className="ml-auto text-xs text-muted-foreground tabular-nums">{px(size)}</span>
							) : null}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
