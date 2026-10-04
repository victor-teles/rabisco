import { memo, useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ScreenFrame } from "@/components/app/screen-preview";
import { boundsOf, rectFromPoints, type Rect } from "@/lib/align";
import { marqueeSelection, sameSelection, selectedFrames, toggleInSelection } from "@/lib/selection";
import { cn } from "@/lib/utils";
import type { Frame, ProjectFiles } from "../../../shared/types";

export type Tool = "move" | "hand";

export type Viewport = { x: number; y: number; zoom: number };

export type CanvasHandle = {
	zoomBy: (factor: number) => void;
	fitTo: (rects: Rect[]) => void;
	resetZoom: () => void;
};

export type FrameMove = { file: string; x: number; y: number };

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const FIT_PADDING = 96;
/** Screen pixels the pointer travels before a press becomes a drag */
const DRAG_THRESHOLD = 3;

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

type CanvasProps = {
	frames: Frame[];
	files: ProjectFiles;
	selection: string[];
	onSelectionChange: (selection: string[]) => void;
	/** Called on every pointer move of a drag; `dragId` is stable for one drag */
	onMoveFrames: (moves: FrameMove[], dragId: string) => void;
	/** The drag that moved frames ended */
	onMoveEnd: () => void;
	tool: Tool;
	viewport: Viewport;
	onViewportChange: (viewport: Viewport) => void;
	handleRef?: Ref<CanvasHandle>;
	children?: React.ReactNode;
};

type Point = { x: number; y: number };

type Drag =
	| { kind: "pan"; startX: number; startY: number; origin: Viewport }
	| {
			kind: "frames";
			id: string;
			startX: number;
			startY: number;
			origins: FrameMove[];
			moved: boolean;
			/** Pressed an already-selected frame: a click without moving selects only it */
			pressed: string | null;
	  }
	| { kind: "marquee"; start: Point; current: Point; base: string[]; additive: boolean; moved: boolean };

/**
 * Infinite canvas: wheel pans, ⌘/ctrl + wheel (or pinch) zooms around the
 * cursor, space, the hand tool or the middle button drags the view. In move
 * mode, frames drag (the whole selection moves together) and empty space
 * draws a selection marquee.
 */
export function Canvas({
	frames,
	files,
	selection,
	onSelectionChange,
	onMoveFrames,
	onMoveEnd,
	tool,
	viewport,
	onViewportChange,
	handleRef,
	children,
}: CanvasProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [drag, setDrag] = useState<Drag | null>(null);
	const [spaceHeld, setSpaceHeld] = useState(false);
	const viewportRef = useRef(viewport);
	viewportRef.current = viewport;

	const zoomAround = useCallback(
		(factor: number, clientX?: number, clientY?: number) => {
			const rect = containerRef.current?.getBoundingClientRect();
			if (!rect) return;
			const current = viewportRef.current;
			const px = (clientX ?? rect.left + rect.width / 2) - rect.left;
			const py = (clientY ?? rect.top + rect.height / 2) - rect.top;
			const zoom = clampZoom(current.zoom * factor);
			const ratio = zoom / current.zoom;
			onViewportChange({ zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio });
		},
		[onViewportChange],
	);

	const fitTo = useCallback(
		(targets: Rect[]) => {
			const rect = containerRef.current?.getBoundingClientRect();
			const bounds = boundsOf(targets);
			if (!rect || !bounds) return;
			const zoom = clampZoom(
				Math.min((rect.width - FIT_PADDING * 2) / bounds.width, (rect.height - FIT_PADDING * 2) / bounds.height, 1),
			);
			onViewportChange({
				zoom,
				x: rect.width / 2 - (bounds.x + bounds.width / 2) * zoom,
				y: rect.height / 2 - (bounds.y + bounds.height / 2) * zoom,
			});
		},
		[onViewportChange],
	);

	useImperativeHandle(
		handleRef,
		() => ({
			zoomBy: (factor) => zoomAround(factor),
			fitTo,
			resetZoom: () => zoomAround(1 / viewportRef.current.zoom),
		}),
		[zoomAround, fitTo],
	);

	// Non-passive wheel listener so we can stop the webview from scrolling/zooming
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			if (event.ctrlKey || event.metaKey) {
				zoomAround(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
			} else {
				const current = viewportRef.current;
				onViewportChange({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY });
			}
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [zoomAround, onViewportChange]);

	useEffect(() => {
		const isTyping = (target: EventTarget | null) =>
			target instanceof HTMLElement && (target.isContentEditable || /input|textarea/i.test(target.tagName));
		const down = (event: KeyboardEvent) => {
			if (event.code === "Space" && !isTyping(event.target)) {
				event.preventDefault();
				setSpaceHeld(true);
			}
		};
		const up = (event: KeyboardEvent) => {
			if (event.code === "Space") setSpaceHeld(false);
		};
		const blur = () => setSpaceHeld(false);
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		window.addEventListener("blur", blur);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
			window.removeEventListener("blur", blur);
		};
	}, []);

	const panning = tool === "hand" || spaceHeld;

	const toCanvas = (clientX: number, clientY: number): Point => {
		const rect = containerRef.current!.getBoundingClientRect();
		return { x: (clientX - rect.left - viewport.x) / viewport.zoom, y: (clientY - rect.top - viewport.y) / viewport.zoom };
	};

	const startFrameDrag = (event: React.PointerEvent, dragged: string[], pressed: string | null) => {
		setDrag({
			kind: "frames",
			id: crypto.randomUUID(),
			startX: event.clientX,
			startY: event.clientY,
			origins: selectedFrames(frames, dragged).map(({ file, x, y }) => ({ file, x, y })),
			moved: false,
			pressed,
		});
	};

	const onPointerDown = (event: React.PointerEvent) => {
		if (event.button !== 0 && event.button !== 1) return;
		event.currentTarget.setPointerCapture(event.pointerId);

		if (panning || event.button === 1) {
			event.preventDefault();
			setDrag({ kind: "pan", startX: event.clientX, startY: event.clientY, origin: viewport });
			return;
		}

		const file = (event.target as HTMLElement).closest<HTMLElement>("[data-frame-file]")?.dataset.frameFile;
		if (!file) {
			if (!event.shiftKey) onSelectionChange([]);
			const start = toCanvas(event.clientX, event.clientY);
			setDrag({ kind: "marquee", start, current: start, base: selection, additive: event.shiftKey, moved: false });
			return;
		}

		if (event.shiftKey) {
			const next = toggleInSelection(selection, file);
			onSelectionChange(next);
			if (next.includes(file)) startFrameDrag(event, next, null);
		} else if (selection.includes(file)) {
			startFrameDrag(event, selection, file);
		} else {
			onSelectionChange([file]);
			startFrameDrag(event, [file], null);
		}
	};

	const onPointerMove = (event: React.PointerEvent) => {
		if (!drag) return;
		if (drag.kind === "pan") {
			onViewportChange({
				...drag.origin,
				x: drag.origin.x + event.clientX - drag.startX,
				y: drag.origin.y + event.clientY - drag.startY,
			});
		} else if (drag.kind === "frames") {
			const dx = event.clientX - drag.startX;
			const dy = event.clientY - drag.startY;
			if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
			if (!drag.moved) setDrag({ ...drag, moved: true });
			onMoveFrames(
				drag.origins.map((origin) => ({
					file: origin.file,
					x: Math.round(origin.x + dx / viewport.zoom),
					y: Math.round(origin.y + dy / viewport.zoom),
				})),
				drag.id,
			);
		} else {
			const current = toCanvas(event.clientX, event.clientY);
			const moved = drag.moved || Math.hypot(current.x - drag.start.x, current.y - drag.start.y) * viewport.zoom >= DRAG_THRESHOLD;
			if (!moved) return;
			setDrag({ ...drag, current, moved });
			const next = marqueeSelection(frames, rectFromPoints(drag.start, current), drag.base, drag.additive);
			if (!sameSelection(next, selection)) onSelectionChange(next);
		}
	};

	const endDrag = () => {
		if (drag?.kind === "frames") {
			if (drag.moved) onMoveEnd();
			else if (drag.pressed && selection.length > 1) onSelectionChange([drag.pressed]);
		}
		setDrag(null);
	};

	const gridSize = 24 * viewport.zoom;
	const selected = new Set(selection);
	const selectionBounds = selection.length > 1 ? boundsOf(selectedFrames(frames, selection)) : null;
	const marquee = drag?.kind === "marquee" && drag.moved ? rectFromPoints(drag.start, drag.current) : null;

	return (
		<div
			ref={containerRef}
			className={cn(
				"relative h-full w-full touch-none overflow-hidden bg-muted/50 select-none",
				panning || drag?.kind === "pan" ? (drag ? "cursor-grabbing" : "cursor-grab") : "cursor-default",
			)}
			style={{
				backgroundImage:
					viewport.zoom > 0.25
						? "radial-gradient(circle, color-mix(in oklab, var(--foreground) 14%, transparent) 1px, transparent 1px)"
						: undefined,
				backgroundSize: `${gridSize}px ${gridSize}px`,
				backgroundPosition: `${viewport.x}px ${viewport.y}px`,
			}}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onAuxClick={(event) => event.preventDefault()}
		>
			<div
				className="absolute top-0 left-0 origin-top-left"
				style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
			>
				{frames.map((frame) => (
					<FrameView key={frame.file} frame={frame} files={files} selected={selected.has(frame.file)} zoom={viewport.zoom} />
				))}
				{selectionBounds ? (
					<div
						className="pointer-events-none absolute"
						style={{
							left: selectionBounds.x,
							top: selectionBounds.y,
							width: selectionBounds.width,
							height: selectionBounds.height,
							outline: `${1 / viewport.zoom}px solid color-mix(in oklab, var(--primary) 60%, transparent)`,
							outlineOffset: 8 / viewport.zoom,
						}}
					/>
				) : null}
				{marquee ? (
					<div
						className="pointer-events-none absolute bg-primary/8"
						style={{
							left: marquee.x,
							top: marquee.y,
							width: marquee.width,
							height: marquee.height,
							outline: `${1 / viewport.zoom}px solid var(--primary)`,
						}}
					/>
				) : null}
			</div>
			{children}
		</div>
	);
}

/** One frame: its label and the sandboxed screen. Memoized so drags of other frames don't re-render it. */
const FrameView = memo(function FrameView({
	frame,
	files,
	selected,
	zoom,
}: {
	frame: Frame;
	files: ProjectFiles;
	selected: boolean;
	zoom: number;
}) {
	return (
		<div
			data-frame-file={frame.file}
			className="group/frame absolute"
			style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
		>
			<div
				className={cn(
					"absolute bottom-full left-0 mb-1 origin-bottom-left truncate text-xs font-medium whitespace-nowrap",
					selected ? "text-primary" : "text-muted-foreground",
				)}
				style={{ transform: `scale(${1 / zoom})`, maxWidth: frame.width * zoom }}
			>
				{frame.name}
			</div>
			<div
				className={cn("h-full w-full overflow-hidden bg-white", frame.device === "mobile" ? "rounded-[28px]" : "rounded-md")}
				style={{
					boxShadow: selected
						? `0 0 0 ${2 / zoom}px var(--primary), 0 10px 40px -12px rgb(0 0 0 / 0.25)`
						: `0 0 0 ${1 / zoom}px color-mix(in oklab, var(--foreground) 10%, transparent), 0 10px 40px -12px rgb(0 0 0 / 0.2)`,
				}}
			>
				<ScreenFrame entry={frame.file} files={files} width={frame.width} height={frame.height} />
			</div>
			{selected ? null : (
				<div
					className={cn(
						"pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover/frame:opacity-100",
						frame.device === "mobile" ? "rounded-[28px]" : "rounded-md",
					)}
					style={{ boxShadow: `0 0 0 ${1.5 / zoom}px color-mix(in oklab, var(--primary) 70%, transparent)` }}
				/>
			)}
		</div>
	);
});

