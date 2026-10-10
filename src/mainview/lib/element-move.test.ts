import { describe, expect, test } from "bun:test";
import { moveElement } from "../../shared/jsx";
import { draggedElement, draggedEntry, entryOrder, entryPlacement, moveTarget } from "./element-move";
import type { DropLayout } from "./render/protocol";

const SCREEN = `export default function Home() {
	const items = ["a", "b"];
	return (
		<main className="flex flex-col gap-4">
			<section className="flex">
				<h1>Title</h1>
				<p>Body</p>
			</section>
			<div className="card">
				<span>Inner</span>
			</div>
			<ul>
				{items.map((item) => (
					<li key={item}>{item}</li>
				))}
			</ul>
		</main>
	);
}
`;

const at = (needle: string) => {
	const index = SCREEN.indexOf(needle);

	if (index < 0) throw new Error(`missing ${needle}`);

	return index;
};

describe("draggedElement", () => {
	test("spans the element's source", () => {
		const start = at("<section");

		expect(draggedElement(SCREEN, start)).toEqual({ start, end: at("</section>") + "</section>".length });
	});

	test("refuses the root and elements inside expressions", () => {
		expect(draggedElement(SCREEN, at("<main"))).toBeNull();
		expect(draggedElement(SCREEN, at("<li"))).toBeNull();
	});
});

describe("moveTarget", () => {
	const section = draggedElement(SCREEN, at("<section"))!;

	test("passes hits inside the dragged element to its parent", () => {
		const starts = [at("<h1"), at("<section"), at("<main")];

		expect(moveTarget(SCREEN, section, starts)?.parent).toBe(at("<main"));
	});

	test("goes into another container", () => {
		const starts = [at("<span"), at('<div className="card"'), at("<main")];
		const target = moveTarget(SCREEN, section, starts)!;

		expect(target.parent).toBe(at('<div className="card"'));
		// The placement's index lands the move where the line showed
		const moved = moveElement(SCREEN, section.start, target.parent, 0)!;

		expect(moved.source.indexOf("<section")).toBeGreaterThan(moved.source.indexOf('<div className="card"'));
		expect(moved.source.indexOf("<section")).toBeLessThan(moved.source.indexOf("<span"));
	});

	test("never targets the dragged element's own subtree", () => {
		const main = { start: at("<main"), end: SCREEN.lastIndexOf("</main>") + "</main>".length };

		expect(moveTarget(SCREEN, main, [at("<h1"), at("<section"), at("<main")])).toBeNull();
	});
});

describe("entryPlacement", () => {
	const source = `const tabs = ["a", "b", "c"];

export default function Nav() {
	return <nav className="flex">{tabs.map((tab) => <button key={tab}>{tab}</button>)}</nav>;
}
`;

	const start = source.indexOf("<button");
	const entry = draggedEntry(source, start)!;
	const box = (x: number) => ({ x, y: 0, width: 100, height: 50 });

	const layout: DropLayout = {
		start: entry.parent,
		version: "v",
		box: { x: 0, y: 0, width: 300, height: 50 },
		display: "flex",
		flexDirection: "row",
		flexWrap: "nowrap",
		gridAutoFlow: "row",
		gridColumns: 0,
		direction: "ltr",
		children: [0, 100, 200].map((x) => ({ start, box: box(x) })),
	};

	test("reads the dragged item and its siblings from the source", () => {
		expect(entry).toEqual({ start, parent: source.indexOf("<nav"), count: 3 });
		expect(draggedElement(source, start)).toBeNull();
	});

	test("places the pressed instance where the pointer is, counted after it leaves", () => {
		expect(entryPlacement(layout, entry, box(0), { x: 290, y: 25 })).toMatchObject({ from: 0, to: 2 });
		expect(entryPlacement(layout, entry, box(200), { x: 10, y: 25 })).toMatchObject({ from: 2, to: 0 });
		expect(entryPlacement(layout, entry, box(100), { x: 140, y: 25 })).toMatchObject({ from: 1, to: 1 });
	});

	test("refuses when the instances don't pair up with the entries", () => {
		const fewer = { ...layout, children: layout.children.slice(1) };

		expect(entryPlacement(fewer, entry, box(100), { x: 10, y: 25 })).toBeNull();
	});
});

test("entryOrder moves one index", () => {
	expect(entryOrder(4, 0, 3)).toEqual([1, 2, 3, 0]);
	expect(entryOrder(4, 3, 1)).toEqual([0, 3, 1, 2]);
	expect(entryOrder(3, 1, 1)).toEqual([0, 1, 2]);
});
