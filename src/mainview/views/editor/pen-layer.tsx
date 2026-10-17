import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { penPathData, penSnippet, type PenPoint } from "@/lib/pen-path";
import type { ViewportStore } from "@/lib/viewport";
import { Kbd } from "@/components/ui/kbd";
import type { Frame } from "../../../shared/types";

type Point = { x: number; y: number };

/** A press closer than this to the first anchor closes the path, in pixels */
const CLOSE_RADIUS = 8;

/** A press that moves less than this places a corner, in pixels */
const DRAG_THRESHOLD = 3;

/** `snippet` is the inline SVG; `clientX` and `clientY` are the first anchor, where it goes in the screen */
export type PenPath = { file: string; snippet: string; clientX: number; clientY: number };

type Draft = {
	file: string;
	/** Canvas coordinates */
	points: PenPoint[];
	first: { clientX: number; clientY: number };
	/** Where a handle is being dragged out of the last anchor */
	pulling: { clientX: number; clientY: number } | null;
};

/**
 * The pen tool: each press inside a screen adds an anchor, and dragging it out curves the path. Pressing the
 * first anchor closes the path; Enter or a double-click finishes it open; Backspace takes the last anchor back.
 */
export function PenLayer({
	view,
	frames,
	frameAt,
	toCanvas,
	onFinish,
	onCancel,
}: {
	view: ViewportStore;
	frames: Frame[];
	frameAt: (clientX: number, clientY: number) => Frame | undefined;
	toCanvas: (clientX: number, clientY: number) => Point;
	onFinish: (path: PenPath) => void;
	onCancel: () => void;
}) {
	const { x, y, zoom } = useSyncExternalStore(view.subscribe, view.get);
	const rootRef = useRef<HTMLDivElement>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [pointer, setPointer] = useState<Point | null>(null);

	/** The clicks of a double-click place anchors on the last one; they go */
	const finish = (closed: boolean) => {
		const frame = draft && frames.find((f) => f.file === draft.file);
		setDraft(null);

		if (!draft || !frame) return;

		const points = draft.points.flatMap((point, i) => {
			const previous = draft.points[i - 1];

			return previous && !point.handle && Math.hypot(point.x - previous.x, point.y - previous.y) * zoom < DRAG_THRESHOLD
				? []
				: [{ ...point, x: point.x - frame.x, y: point.y - frame.y }];
		});

		const snippet = penSnippet(points, closed);

		if (snippet) onFinish({ file: draft.file, snippet, ...draft.first });
		else onCancel();
	};

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Enter") finish(false);
			else if (event.key === "Escape") {
				setDraft(null);
				onCancel();
			} else if ((event.key === "Backspace" || event.key === "Delete") && draft) {
				setDraft(draft.points.length > 1 ? { ...draft, points: draft.points.slice(0, -1) } : null);
			} else return;

			event.preventDefault();
			event.stopPropagation();
		};

		window.addEventListener("keydown", onKey, true);

		return () => window.removeEventListener("keydown", onKey, true);
	});

	const screen = (point: Point) => ({ x: x + point.x * zoom, y: y + point.y * zoom });

	const local = (clientX: number, clientY: number) => {
		const rect = rootRef.current?.getBoundingClientRect();

		return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
	};

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const point = toCanvas(event.clientX, event.clientY);

		if (draft) {
			const first = draft.points[0]!;
			const near = Math.hypot((point.x - first.x) * zoom, (point.y - first.y) * zoom) <= CLOSE_RADIUS;

			if (near && draft.points.length > 2) return finish(true);
			event.currentTarget.setPointerCapture(event.pointerId);

			return setDraft({
				...draft,
				points: [...draft.points, point],
				pulling: { clientX: event.clientX, clientY: event.clientY },
			});
		}

		const frame = frameAt(event.clientX, event.clientY);

		if (!frame) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		setDraft({
			file: frame.file,
			points: [point],
			first: { clientX: event.clientX, clientY: event.clientY },
			pulling: { clientX: event.clientX, clientY: event.clientY },
		});
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		setPointer(local(event.clientX, event.clientY));

		if (!draft?.pulling) return;
		const moved = Math.hypot(event.clientX - draft.pulling.clientX, event.clientY - draft.pulling.clientY);
		const last = draft.points[draft.points.length - 1]!;
		const point = toCanvas(event.clientX, event.clientY);
		const handle = moved < DRAG_THRESHOLD ? undefined : { x: point.x - last.x, y: point.y - last.y };

		setDraft({ ...draft, points: [...draft.points.slice(0, -1), { x: last.x, y: last.y, handle }] });
	};

	const onPointerUp = () => {
		if (draft?.pulling) setDraft({ ...draft, pulling: null });
	};

	const shown = draft?.points.map((point) => {
		const at = screen(point);

		return { ...at, handle: point.handle && { x: point.handle.x * zoom, y: point.handle.y * zoom } };
	});

	const last = shown?.[shown.length - 1];

	const closing =
		!!shown &&
		shown.length > 2 &&
		!!pointer &&
		Math.hypot(pointer.x - shown[0]!.x, pointer.y - shown[0]!.y) <= CLOSE_RADIUS;

	return (
		<div
			ref={rootRef}
			className="absolute inset-0 z-10 cursor-crosshair"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerLeave={() => setPointer(null)}
			onDoubleClick={(event) => {
				event.stopPropagation();
				finish(false);
			}}
		>
			<svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
				{shown && shown.length > 1 ? (
					<path d={penPathData(shown, false)} fill="none" stroke="var(--primary)" strokeWidth={1.5} />
				) : null}
				{last && pointer && !draft?.pulling ? (
					<line
						x1={last.x}
						y1={last.y}
						x2={pointer.x}
						y2={pointer.y}
						stroke="var(--primary)"
						strokeWidth={1}
						strokeDasharray="4 3"
					/>
				) : null}
				{last?.handle ? (
					<>
						<line
							x1={last.x - last.handle.x}
							y1={last.y - last.handle.y}
							x2={last.x + last.handle.x}
							y2={last.y + last.handle.y}
							stroke="var(--primary)"
							strokeWidth={1}
						/>
						<circle cx={last.x + last.handle.x} cy={last.y + last.handle.y} r={3} fill="var(--primary)" />
						<circle cx={last.x - last.handle.x} cy={last.y - last.handle.y} r={3} fill="var(--primary)" />
					</>
				) : null}
				{shown?.map((point, i) => (
					<rect
						key={i}
						x={point.x - 3.5}
						y={point.y - 3.5}
						width={7}
						height={7}
						fill={i === 0 && closing ? "var(--primary)" : "var(--background)"}
						stroke="var(--primary)"
						strokeWidth={1.5}
					/>
				))}
			</svg>
			<div className="pointer-events-none absolute bottom-20 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-muted-foreground shadow-sm">
				{draft ? (
					<>
						<span>{closing ? "Click to close the path" : "Click to add points, drag to curve"}</span>
						<span className="flex items-center gap-1">
							<Kbd>↵</Kbd> finish
						</span>
						<span className="flex items-center gap-1">
							<Kbd>⌫</Kbd> remove point
						</span>
						<span className="flex items-center gap-1">
							<Kbd>Esc</Kbd> cancel
						</span>
					</>
				) : (
					<span>Click inside a screen to start a path</span>
				)}
			</div>
		</div>
	);
}
