import { describe, expect, test } from "bun:test";
import { flowFrames, flowLayout, screenEdges, tidyUp } from "./arrange";

const screen = (file: string, x: number, y: number, width = 100, height = 200) => ({ file, x, y, width, height });

describe("tidyUp", () => {
	test("keeps the rows and their order, with one gap", () => {
		const rects = [screen("b", 260, 30), screen("a", 10, 0), screen("c", 40, 320, 50, 50)];

		expect(tidyUp(rects, 20)).toEqual([screen("b", 130, 0), screen("a", 10, 0), screen("c", 10, 220, 50, 50)]);
	});

	test("lines cells up in columns as wide as their widest", () => {
		const rects = [screen("a", 0, 0, 300), screen("b", 400, 0), screen("c", 0, 300), screen("d", 150, 300)];
		const tidied = tidyUp(rects, 10);

		expect(tidied.map((rect) => [rect.x, rect.y])).toEqual([
			[0, 0],
			[310, 0],
			[0, 210],
			[310, 210],
		]);
	});

	test("leaves one rect alone", () => {
		const rects = [screen("a", 5, 5)];

		expect(tidyUp(rects, 10)).toBe(rects);
	});
});

describe("flowLayout", () => {
	test("puts screens in columns by their distance from the start", () => {
		const rects = [screen("done", 0, 0), screen("home", 500, 500), screen("cart", 900, 0)];

		const edges = [
			{ from: "home", to: "cart" },
			{ from: "cart", to: "done" },
		];

		const { placed, unlinked } = flowLayout(rects, edges, 10);

		expect(placed).toEqual([screen("done", 240, 0), screen("home", 0, 0), screen("cart", 120, 0)]);
		expect(unlinked).toEqual([]);
	});

	test("stacks branches and puts unlinked screens in a row below", () => {
		const rects = [screen("home", 0, 0), screen("a", 0, 300), screen("b", 0, 600), screen("lonely", 0, 900)];

		const edges = [
			{ from: "home", to: "a" },
			{ from: "home", to: "b" },
			{ from: "a", to: "a" },
		];

		const { placed, unlinked } = flowLayout(rects, edges, 10);

		expect(placed).toEqual([
			screen("home", 0, 0),
			screen("a", 120, 0),
			screen("b", 120, 210),
			screen("lonely", 0, 420),
		]);
		expect(unlinked.map((rect) => rect.file)).toEqual(["lonely"]);
	});

	test("starts a cycle with no entry at its first screen in reading order", () => {
		const rects = [screen("b", 200, 0), screen("a", 0, 0)];

		const edges = [
			{ from: "a", to: "b" },
			{ from: "b", to: "a" },
		];

		expect(flowLayout(rects, edges, 10).placed).toEqual([screen("b", 120, 0), screen("a", 0, 0)]);
	});

	test("orders a column by the rows of the screens that link to it", () => {
		const rects = [screen("s1", 0, 0), screen("s2", 0, 300), screen("t2", 300, 0), screen("t1", 300, 300)];

		const edges = [
			{ from: "s1", to: "t1" },
			{ from: "s2", to: "t2" },
		];

		const placed = flowLayout(rects, edges, 10).placed;

		expect(placed.find((rect) => rect.file === "t1")!.y).toBe(0);
		expect(placed.find((rect) => rect.file === "t2")!.y).toBe(210);
	});
});

describe("flowFrames", () => {
	test("moves alternates with their screen", () => {
		const frames = [screen("home", 500, 0), screen("home.alt", 500, 300), screen("next", 0, 0)];
		const edges = [{ from: "home", to: "next" }];
		const groupOf = (file: string) => file.replace(".alt", "");

		const { placed } = flowFrames(frames, edges, 10, groupOf);

		expect(placed).toEqual([screen("home", 0, 0), screen("home.alt", 0, 300), screen("next", 120, 0)]);
	});
});

describe("screenEdges", () => {
	test("keeps links between screens only", () => {
		const files = {
			"screens/home.tsx": `export default function Home() {
	return (
		<div>
			<button data-link-to="cart">Cart</button>
			<a data-link-to="https://example.com">Site</a>
			<button data-link-to="back">Back</button>
		</div>
	);
}`,
			"screens/cart.tsx": "export default function Cart() { return <div />; }",
		};

		expect(screenEdges(files)).toEqual([{ from: "screens/home.tsx", to: "screens/cart.tsx" }]);
	});
});
