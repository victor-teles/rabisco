import { describe, expect, test } from "bun:test";
import { gridColumns, MAX_COLUMNS, parseLayoutGrid } from "./layout-grid";

describe("gridColumns", () => {
	test("splits the room between the margins into equal columns", () => {
		expect(gridColumns({ columns: 4, gutter: 16, margin: 16 }, 392)).toEqual([
			{ x: 16, width: 78 },
			{ x: 110, width: 78 },
			{ x: 204, width: 78 },
			{ x: 298, width: 78 },
		]);
	});

	test("one column fills the space inside the margins", () => {
		expect(gridColumns({ columns: 1, gutter: 40, margin: 20 }, 200)).toEqual([{ x: 20, width: 160 }]);
	});

	test("draws nothing when margins and gutters take the whole width", () => {
		expect(gridColumns({ columns: 3, gutter: 50, margin: 50 }, 200)).toEqual([]);
	});
});

describe("parseLayoutGrid", () => {
	test("missing or malformed grids are left out", () => {
		expect(parseLayoutGrid(undefined)).toBeUndefined();
		expect(parseLayoutGrid("12")).toBeUndefined();
		expect(parseLayoutGrid({ columns: 12, gutter: 24 })).toBeUndefined();
	});

	test("rounds and clamps hand-edited values", () => {
		expect(parseLayoutGrid({ columns: 0, gutter: -4, margin: 12.6 })).toEqual({ columns: 1, gutter: 0, margin: 13 });
		expect(parseLayoutGrid({ columns: 500, gutter: 8, margin: 8 })?.columns).toBe(MAX_COLUMNS);
	});
});
