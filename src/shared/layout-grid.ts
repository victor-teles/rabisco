import { isFiniteNumber } from "./guards";
import { isJsonObject, type Json } from "./json";
import type { Device, LayoutGrid } from "./types";

type Column = { x: number; width: number };

export const MAX_COLUMNS = 48;

export const DEFAULT_LAYOUT_GRID: Record<Device, LayoutGrid> = {
	mobile: { columns: 4, gutter: 16, margin: 16 },
	tablet: { columns: 8, gutter: 24, margin: 32 },
	desktop: { columns: 12, gutter: 24, margin: 80 },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

export function normalizeLayoutGrid(grid: LayoutGrid): LayoutGrid {
	return {
		columns: clamp(grid.columns, 1, MAX_COLUMNS),
		gutter: clamp(grid.gutter, 0, Number.MAX_SAFE_INTEGER),
		margin: clamp(grid.margin, 0, Number.MAX_SAFE_INTEGER),
	};
}

export function parseLayoutGrid(raw: Json | undefined): LayoutGrid | undefined {
	if (!isJsonObject(raw)) return undefined;
	const { columns, gutter, margin } = raw;

	if (!isFiniteNumber(columns) || !isFiniteNumber(gutter) || !isFiniteNumber(margin)) return undefined;

	return normalizeLayoutGrid({ columns, gutter, margin });
}

export function gridColumns(grid: LayoutGrid, width: number): Column[] {
	const room = width - grid.margin * 2 - grid.gutter * (grid.columns - 1);

	if (grid.columns < 1 || room <= 0) return [];
	const column = room / grid.columns;

	return Array.from({ length: grid.columns }, (_, i) => ({
		x: grid.margin + i * (column + grid.gutter),
		width: column,
	}));
}
