import { describe, expect, test } from "bun:test";
import { arrowSteps, flowOf, moveSteps, parentOf, styleAt } from "./element-flow";

describe("styleAt", () => {
	test("applies the breakpoints the frame width reaches", () => {
		const classes = "flex flex-col md:flex-row";

		expect(styleAt(classes, "flexDirection", 390)).toBe("col");
		expect(styleAt(classes, "flexDirection", 1440)).toBe("row");
		expect(styleAt(classes, "flexDirection", null)).toBe("col");
	});
});

describe("flowOf", () => {
	test("reads flex rows, columns, grids and normal flow", () => {
		expect(flowOf("flex gap-2", null)).toEqual({ kind: "row", reverse: false, columns: 1 });
		expect(flowOf("flex flex-col-reverse", null)).toEqual({ kind: "column", reverse: true, columns: 1 });
		expect(flowOf("grid grid-cols-2 lg:grid-cols-4", 1440)).toEqual({ kind: "grid", reverse: false, columns: 4 });
		expect(flowOf("p-4", null)).toEqual({ kind: "block", reverse: false, columns: 1 });
	});
});

describe("arrowSteps", () => {
	test("a row moves with ← and →, and ignores ↑ and ↓", () => {
		const row = flowOf("flex", null);

		expect(arrowSteps(row, "ArrowLeft")).toBe(-1);
		expect(arrowSteps(row, "ArrowRight")).toBe(1);
		expect(arrowSteps(row, "ArrowUp")).toBeNull();
	});

	test("a column and normal flow move with ↑ and ↓", () => {
		expect(arrowSteps(flowOf("flex flex-col", null), "ArrowDown")).toBe(1);
		expect(arrowSteps(flowOf("space-y-4", null), "ArrowUp")).toBe(-1);
		expect(arrowSteps(flowOf("flex flex-col", null), "ArrowRight")).toBeNull();
	});

	test("a reversed row follows what the screen shows", () => {
		expect(arrowSteps(flowOf("flex flex-row-reverse", null), "ArrowRight")).toBe(-1);
	});

	test("a grid moves by one across and by a row down", () => {
		const grid = flowOf("grid grid-cols-3", null);

		expect(arrowSteps(grid, "ArrowRight")).toBe(1);
		expect(arrowSteps(grid, "ArrowDown")).toBe(3);
		expect(arrowSteps(grid, "ArrowUp")).toBe(-3);
	});

	test("an unknown parent moves with every arrow", () => {
		expect(arrowSteps(null, "ArrowUp")).toBe(-1);
		expect(arrowSteps(null, "ArrowRight")).toBe(1);
	});
});

const SOURCE = `export default function Screen() {
	return (
		<div className="grid grid-cols-2">
			<a>1</a>
			<b>2</b>
			<i>3</i>
		</div>
	);
}
`;

describe("parentOf", () => {
	test("reads the parent's flow and its children", () => {
		const parent = parentOf(SOURCE, SOURCE.indexOf("<b>"), null);

		expect(parent?.flow.kind).toBe("grid");
		expect(parent?.children).toEqual([SOURCE.indexOf("<a>"), SOURCE.indexOf("<b>"), SOURCE.indexOf("<i>")]);
	});

	test("is null for a component parent", () => {
		const source = `const A = () => (\n\t<Card>\n\t\t<p>A</p>\n\t</Card>\n);\n`;

		expect(parentOf(source, source.indexOf("<p"), null)).toBeNull();
	});
});

describe("moveSteps", () => {
	test("moves past several siblings", () => {
		const moved = moveSteps(SOURCE, SOURCE.indexOf("<a>"), 2);

		expect(moved?.source).toContain("<b>2</b>\n\t\t\t<i>3</i>\n\t\t\t<a>1</a>");
		expect(moved?.source.indexOf("<a>")).toBe(moved?.start);
	});

	test("refuses a move past the edge", () => {
		expect(moveSteps(SOURCE, SOURCE.indexOf("<b>"), 2)).toBeNull();
	});
});
