import { useCallback, useRef, useState } from "react";
import { isFiniteNumber } from "../../../shared/guards";
import { cn } from "@/lib/utils";

type PanelSize = { key: string; initial: number; min: number; max: number };

const clamp = (value: number, { min, max }: PanelSize) => Math.round(Math.min(max, Math.max(min, value)));

function storedSize(size: PanelSize) {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(size.key) ?? "null");

		return isFiniteNumber(value) ? clamp(value, size) : size.initial;
	} catch {
		return size.initial;
	}
}

/** A panel width kept in localStorage; it is saved when a resize ends, not on every pointer move */
export function usePanelSize(size: PanelSize) {
	const [width, setWidth] = useState(() => storedSize(size));
	const resize = useCallback((next: number) => setWidth(clamp(next, size)), [size]);
	const save = useCallback(() => localStorage.setItem(size.key, JSON.stringify(width)), [size.key, width]);

	const reset = useCallback(() => {
		setWidth(size.initial);
		localStorage.removeItem(size.key);
	}, [size.initial, size.key]);

	return { width, resize, save, reset, min: size.min, max: size.max };
}

const KEY_STEP = 16;

/**
 * The drag edge of a side panel. `edge` is the panel side it sits on: dragging away from the panel widens it.
 * Arrow keys resize it too, and a double-click resets it.
 */
export function ResizeHandle({
	edge,
	label,
	panel,
}: {
	edge: "left" | "right";
	label: string;
	panel: ReturnType<typeof usePanelSize>;
}) {
	const drag = useRef<{ x: number; width: number } | null>(null);
	const [dragging, setDragging] = useState(false);
	const sign = edge === "right" ? 1 : -1;

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={label}
			aria-valuenow={panel.width}
			aria-valuemin={panel.min}
			aria-valuemax={panel.max}
			tabIndex={0}
			data-dragging={dragging || undefined}
			title="Drag to resize, double-click to reset"
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				drag.current = { x: event.clientX, width: panel.width };
				setDragging(true);
			}}
			onPointerMove={(event) => {
				if (drag.current) panel.resize(drag.current.width + (event.clientX - drag.current.x) * sign);
			}}
			onPointerUp={() => {
				if (!drag.current) return;
				drag.current = null;
				setDragging(false);
				panel.save();
			}}
			onLostPointerCapture={() => {
				drag.current = null;
				setDragging(false);
			}}
			onDoubleClick={panel.reset}
			onKeyDown={(event) => {
				if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
				event.preventDefault();
				const step = (event.shiftKey ? 4 : 1) * KEY_STEP * (event.key === "ArrowRight" ? 1 : -1) * sign;
				panel.resize(panel.width + step);
			}}
			onKeyUp={panel.save}
			className={cn(
				"group/resize absolute inset-y-0 z-20 flex w-2 cursor-col-resize justify-center outline-none",
				edge === "right" ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2",
			)}
		>
			<span className="h-full w-px transition-colors group-hover/resize:bg-ring/60 group-focus-visible/resize:bg-ring group-data-[dragging]/resize:bg-ring" />
		</div>
	);
}
