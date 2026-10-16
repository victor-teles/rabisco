import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChromePortal } from "./chrome-layer";
import { screenNameFromPath } from "../../../shared/project";
import type { Frame } from "../../../shared/types";

type Point = { x: number; y: number };

type Dragging = { pointer: Point; target: Frame | null };

/** Screen pixels the pointer travels before a press on the handle becomes a drag */
const DRAG_THRESHOLD = 3;

/** Screen pixels from the element's right edge to the handle's center, clear of the resize strip */
const OFFSET = 14;

const SIZE = 14;

const ARROW = 8;

type LinkHandleProps = {
	/** Canvas coordinates: the middle of the element's right edge */
	at: Point;
	linked: boolean;
	zoom: () => number;
	toCanvas: (clientX: number, clientY: number) => Point;
	/** The screen a drop at this point links to, if any */
	targetAt: (clientX: number, clientY: number) => Frame | null;
	onLink: (target: Frame) => void;
};

/** Figma's prototype noodle: drag from the handle to a screen to link the element to it. Esc or empty canvas cancels */
export function LinkHandle({ at, linked, zoom, toCanvas, targetAt, onLink }: LinkHandleProps) {
	const [dragging, setDragging] = useState<Dragging | null>(null);
	const press = useRef<Point | null>(null);

	useEffect(() => {
		if (!dragging) return;

		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// Before the editor's Escape, which would select the parent
			event.preventDefault();
			event.stopPropagation();
			press.current = null;
			setDragging(null);
		};

		window.addEventListener("keydown", onKey, true);

		return () => window.removeEventListener("keydown", onKey, true);
	}, [dragging]);

	const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
		if (event.button !== 0) return;
		event.stopPropagation();
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		press.current = { x: event.clientX, y: event.clientY };
	};

	const onPointerMove = (event: React.PointerEvent) => {
		event.stopPropagation();
		const origin = press.current;

		if (!origin) return;

		if (!dragging && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < DRAG_THRESHOLD) return;
		setDragging({ pointer: toCanvas(event.clientX, event.clientY), target: targetAt(event.clientX, event.clientY) });
	};

	const onPointerUp = (event: React.PointerEvent) => {
		event.stopPropagation();
		const wasDragging = press.current !== null && dragging !== null;
		press.current = null;
		setDragging(null);

		if (!wasDragging) return;
		const target = targetAt(event.clientX, event.clientY);

		if (target) onLink(target);
	};

	const cancel = () => {
		press.current = null;
		setDragging(null);
	};

	return (
		<>
			<ChromePortal box={at}>
				<button
					type="button"
					aria-label="Drag to a screen to link"
					title="Drag to a screen to link"
					className={cn(
						"pointer-events-auto absolute grid cursor-crosshair place-items-center rounded-full border-[1.5px] border-primary shadow-xs transition-transform outline-none hover:scale-110",
						linked || dragging ? "bg-primary text-primary-foreground" : "bg-background text-primary",
					)}
					style={{ left: OFFSET - SIZE / 2, top: -SIZE / 2, width: SIZE, height: SIZE }}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerCancel={cancel}
					onLostPointerCapture={() => dragging && cancel()}
					onDoubleClick={(event) => event.stopPropagation()}
					onClick={(event) => event.stopPropagation()}
				>
					<Plus className="size-2.5" strokeWidth={3} aria-hidden />
				</button>
			</ChromePortal>
			{dragging ? <Noodle from={at} dragging={dragging} zoom={zoom()} /> : null}
		</>
	);
}

function Noodle({ from, dragging, zoom }: { from: Point; dragging: Dragging; zoom: number }) {
	const { pointer, target } = dragging;
	const start = { x: from.x * zoom + OFFSET, y: from.y * zoom };
	const end = { x: pointer.x * zoom, y: pointer.y * zoom };
	const bow = Math.min(160, Math.max(24, Math.abs(end.x - start.x) * 0.5));

	return (
		<>
			{target ? (
				<ChromePortal box={target}>
					<div className="absolute inset-0 rounded-[2px] outline-2 outline-primary" />
					<div className="absolute top-0 left-0 -translate-y-[calc(100%+4px)] rounded-[4px] bg-primary px-1 font-sans text-[11px]/4 whitespace-nowrap text-primary-foreground">
						{target.name || screenNameFromPath(target.file)}
					</div>
				</ChromePortal>
			) : null}
			<ChromePortal box={{ x: 0, y: 0 }}>
				<svg className="absolute top-0 left-0 overflow-visible" width={1} height={1} aria-hidden>
					<path
						d={`M ${start.x} ${start.y} C ${start.x + bow} ${start.y}, ${end.x - bow} ${end.y}, ${end.x} ${end.y}`}
						fill="none"
						stroke="var(--primary)"
						strokeWidth={2}
						strokeDasharray={target ? undefined : "4 3"}
					/>
					<polygon
						points={`0,0 ${-ARROW},${-ARROW / 2} ${-ARROW},${ARROW / 2}`}
						fill="var(--primary)"
						transform={`translate(${end.x} ${end.y})`}
					/>
				</svg>
			</ChromePortal>
		</>
	);
}
