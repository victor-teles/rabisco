import { useSyncExternalStore } from "react";
import { gridColumns } from "../../../shared/layout-grid";
import type { Frame } from "../../../shared/types";

const COLUMN_FILL = "color-mix(in oklab, var(--color-red-500) 10%, transparent)";

let shown = true;

const listeners = new Set<() => void>();

export const layoutGrids = {
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

export function LayoutGrids({ frames }: { frames: Frame[] }) {
	const visible = useSyncExternalStore(layoutGrids.subscribe, layoutGrids.shown);

	if (!visible) return null;

	return frames.map((frame) =>
		frame.layoutGrid ? (
			<div
				key={frame.file}
				aria-hidden
				className="pointer-events-none absolute"
				style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
			>
				{gridColumns(frame.layoutGrid, frame.width).map((column, i) => (
					<div
						key={i}
						className="absolute inset-y-0"
						style={{ left: column.x, width: column.width, background: COLUMN_FILL }}
					/>
				))}
			</div>
		) : null,
	);
}
