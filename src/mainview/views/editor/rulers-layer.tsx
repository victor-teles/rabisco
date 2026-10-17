import { useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { rulerTicks } from "@/lib/rulers";
import type { ViewportStore } from "@/lib/viewport";
import { cn } from "@/lib/utils";
import { moveGuide } from "../../../shared/guides";
import type { Frame, FrameGuide } from "../../../shared/types";
import { ChromePortal } from "./chrome-layer";

/** In pixels */
const SIZE = 20;

const GUIDE_COLOR = "var(--color-cyan-500)";

type Point = { x: number; y: number };

let shown = false;

const listeners = new Set<() => void>();

export const rulers = {
	shown: () => shown,
	toggle: () => {
		shown = !shown;

		for (const listener of listeners) listener();
	},
	subscribe: (listener: () => void) => {
		listeners.add(listener);

		return () => void listeners.delete(listener);
	},
};

export const useRulersShown = () => useSyncExternalStore(rulers.subscribe, rulers.shown);

/** A guide being pulled out of a ruler, at a client position; `left` and `top` place the rulers in the client */
type Pull = { axis: FrameGuide["axis"]; clientX: number; clientY: number; left: number; top: number };

/**
 * Rulers along the top and left of the canvas, counting from `origin` (the selected screen) or the canvas origin.
 * Dragging out of a ruler and dropping on a screen adds a guide to it.
 */
export function Rulers({
	view,
	origin,
	frameAt,
	toCanvas,
	onAddGuide,
}: {
	view: ViewportStore;
	origin: Frame | undefined;
	frameAt: (clientX: number, clientY: number) => Frame | undefined;
	toCanvas: (clientX: number, clientY: number) => Point;
	onAddGuide: (frame: Frame, guide: FrameGuide) => void;
}) {
	const { x, y, zoom } = useSyncExternalStore(view.subscribe, view.get);
	const rootRef = useRef<HTMLDivElement>(null);
	const [pull, setPull] = useState<Pull | null>(null);
	const [{ width, height }, setSize] = useState({ width: 0, height: 0 });

	useLayoutEffect(() => {
		const root = rootRef.current;

		if (!root) return;
		const observer = new ResizeObserver(() => setSize({ width: root.clientWidth, height: root.clientHeight }));

		observer.observe(root);

		return () => observer.disconnect();
	}, []);
	const left = x + (origin?.x ?? 0) * zoom;
	const top = y + (origin?.y ?? 0) * zoom;
	const target = pull ? frameAt(pull.clientX, pull.clientY) : undefined;

	const start = (axis: FrameGuide["axis"]) => (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		const root = rootRef.current?.getBoundingClientRect();

		setPull({ axis, clientX: event.clientX, clientY: event.clientY, left: root?.left ?? 0, top: root?.top ?? 0 });
	};

	const move = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (pull) setPull({ ...pull, clientX: event.clientX, clientY: event.clientY });
	};

	const end = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!pull) return;
		setPull(null);
		const frame = frameAt(event.clientX, event.clientY);

		if (!frame) return;
		const point = toCanvas(event.clientX, event.clientY);

		onAddGuide(frame, { axis: pull.axis, at: Math.round(pull.axis === "x" ? point.x - frame.x : point.y - frame.y) });
	};

	const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: () => setPull(null) };

	return (
		<div ref={rootRef} aria-hidden className="pointer-events-none absolute inset-0 z-10">
			<div
				className="pointer-events-auto absolute top-0 right-0 left-5 h-5 cursor-row-resize border-b bg-background/95"
				onPointerDown={start("y")}
				{...handlers}
			>
				<Ruler axis="x" origin={left - SIZE} zoom={zoom} length={width - SIZE} band={origin?.width} />
			</div>
			<div
				className="pointer-events-auto absolute top-5 bottom-0 left-0 w-5 cursor-col-resize border-r bg-background/95"
				onPointerDown={start("x")}
				{...handlers}
			>
				<Ruler axis="y" origin={top - SIZE} zoom={zoom} length={height - SIZE} band={origin?.height} />
			</div>
			<div className="absolute top-0 left-0 size-5 border-r border-b bg-background" />
			{pull ? (
				<div
					className="absolute"
					style={
						pull.axis === "x"
							? { left: pull.clientX - pull.left, top: 0, bottom: 0, borderLeft: `1px solid ${GUIDE_COLOR}` }
							: { top: pull.clientY - pull.top, left: 0, right: 0, borderTop: `1px solid ${GUIDE_COLOR}` }
					}
				>
					{target ? (
						<GuideLabel>
							{Math.round(
								pull.axis === "x"
									? toCanvas(pull.clientX, pull.clientY).x - target.x
									: toCanvas(pull.clientX, pull.clientY).y - target.y,
							)}
						</GuideLabel>
					) : null}
				</div>
			) : null}
		</div>
	);
}

/** `origin` is where 0 sits, in pixels from the ruler's start; `band` marks the origin screen's extent */
function Ruler({
	axis,
	origin,
	zoom,
	length,
	band,
}: {
	axis: "x" | "y";
	origin: number;
	zoom: number;
	length: number;
	band?: number;
}) {
	const ticks = rulerTicks(origin, zoom, length);

	return (
		<svg className="absolute inset-0 size-full overflow-hidden text-subtle-foreground">
			{band === undefined ? null : axis === "x" ? (
				<rect x={origin} y={0} width={band * zoom} height={SIZE} className="fill-primary/10" />
			) : (
				<rect x={0} y={origin} width={SIZE} height={band * zoom} className="fill-primary/10" />
			)}
			{ticks.map((tick) => {
				const size = tick.major ? 8 : 4;

				return axis === "x" ? (
					<g key={tick.value}>
						<line x1={tick.position} x2={tick.position} y1={SIZE - size} y2={SIZE} stroke="currentColor" />
						{tick.major ? (
							<text x={tick.position + 3} y={10} className="fill-current text-[9px] tabular-nums">
								{tick.value}
							</text>
						) : null}
					</g>
				) : (
					<g key={tick.value}>
						<line y1={tick.position} y2={tick.position} x1={SIZE - size} x2={SIZE} stroke="currentColor" />
						{tick.major ? (
							<text
								x={10}
								y={tick.position + 3}
								transform={`rotate(-90 10 ${tick.position + 3})`}
								className="fill-current text-[9px] tabular-nums"
							>
								{tick.value}
							</text>
						) : null}
					</g>
				);
			})}
		</svg>
	);
}

function GuideLabel({ children }: { children: React.ReactNode }) {
	return (
		<span
			className="absolute top-1 left-1 rounded-sm px-1 text-[10px] leading-4 text-white tabular-nums"
			style={{ background: GUIDE_COLOR }}
		>
			{children}
		</span>
	);
}

/** A guide being dragged: which one and where */
type Moving = { file: string; index: number; at: number };

/** The screens' guides; dragging one moves it, and dragging it off its screen removes it */
export function FrameGuides({
	frames,
	interactive,
	toCanvas,
	onChange,
}: {
	frames: Frame[];
	interactive: boolean;
	toCanvas: (clientX: number, clientY: number) => Point;
	onChange: (frame: Frame, guides: FrameGuide[] | undefined) => void;
}) {
	const [moving, setMoving] = useState<Moving | null>(null);

	return frames.flatMap((frame) =>
		(frame.guides ?? []).map((guide, index) => {
			const active = moving?.file === frame.file && moving.index === index;
			const at = active ? moving.at : guide.at;
			const vertical = guide.axis === "x";

			const offset = (event: ReactPointerEvent) => {
				const point = toCanvas(event.clientX, event.clientY);

				return Math.round(vertical ? point.x - frame.x : point.y - frame.y);
			};

			return (
				<ChromePortal
					key={`${frame.file}:${guide.axis}:${index}`}
					box={
						vertical
							? { x: frame.x + at, y: frame.y, height: frame.height }
							: { x: frame.x, y: frame.y + at, width: frame.width }
					}
					className={cn(interactive && "pointer-events-auto", vertical ? "cursor-col-resize" : "cursor-row-resize")}
					style={
						vertical
							? {
									width: 7,
									marginLeft: -3.5,
									background: `linear-gradient(to right, transparent 3px, ${GUIDE_COLOR} 3px 4px, transparent 4px)`,
								}
							: {
									height: 7,
									marginTop: -3.5,
									background: `linear-gradient(to bottom, transparent 3px, ${GUIDE_COLOR} 3px 4px, transparent 4px)`,
								}
					}
					title={`${guide.at}px from the ${vertical ? "left" : "top"}. Drag off the screen to remove.`}
					onPointerDown={(event) => {
						if (!interactive || event.button !== 0) return;
						event.preventDefault();
						event.stopPropagation();
						event.currentTarget.setPointerCapture(event.pointerId);
						setMoving({ file: frame.file, index, at: guide.at });
					}}
					onPointerMove={(event) => active && setMoving({ ...moving, at: offset(event) })}
					onPointerUp={(event) => {
						if (!active) return;
						setMoving(null);
						const next = offset(event);

						if (next !== guide.at) onChange(frame, moveGuide(frame, index, next));
					}}
					onPointerCancel={() => setMoving(null)}
				>
					{active ? <GuideLabel>{at}</GuideLabel> : null}
				</ChromePortal>
			);
		}),
	);
}
