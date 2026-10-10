import { describe, expect, test } from "bun:test";
import { duplicateElement, removeElement } from "../../shared/jsx";
import {
	adjacentRange,
	commonValue,
	editEach,
	outermost,
	restyle,
	retoken,
	sharedClasses,
	toggleStart,
	wrapRange,
} from "./element-selection";

const SOURCE = `export default function Screen() {
	return (
		<div className="p-4">
			<h1 className="text-xl font-bold">Title</h1>
			<p className="text-sm">One</p>
			<span>{label}</span>
			<p className="text-sm text-muted-foreground">Two</p>
		</div>
	);
}
`;

const at = (text: string, from = 0) => SOURCE.indexOf(text, from);

const H1 = at("<h1");

const P1 = at("<p");

const SPAN = at("<span");

const P2 = at("<p", P1 + 1);

const DIV = at("<div");

describe("toggleStart", () => {
	test("adds last and removes, promoting the next one", () => {
		expect(toggleStart([1], 5)).toEqual([1, 5]);
		expect(toggleStart([1, 5], 1)).toEqual([5]);
		expect(toggleStart([1], 1)).toEqual([]);
	});
});

describe("outermost", () => {
	test("drops elements inside another selected one and duplicates", () => {
		expect(outermost(SOURCE, [H1, DIV, P1])).toEqual([DIV]);
		expect(outermost(SOURCE, [H1, P1, H1])).toEqual([H1, P1]);
	});
});

describe("editEach", () => {
	test("restyles several elements in one source, keeping offsets valid", () => {
		const result = editEach(
			SOURCE,
			[H1, P2, P1],
			restyle((classes) => `${classes} text-red-500`),
		);

		expect(result.source).toContain(`<h1 className="text-xl font-bold text-red-500">`);
		expect(result.source).toContain(`<p className="text-sm text-red-500">One`);
		expect(result.source).toContain(`<p className="text-sm text-muted-foreground text-red-500">Two`);

		for (const start of result.starts) expect(result.source.slice(start!, start! + 2)).toMatch(/^<[hp]$/);
	});

	test("restyles a parent and its child", () => {
		const result = editEach(
			SOURCE,
			[DIV, H1],
			restyle((classes) => `${classes} gap-2`),
		);

		expect(result.source).toContain(`<div className="p-4 gap-2">`);
		expect(result.source).toContain(`<h1 className="text-xl font-bold gap-2">`);
		expect(result.source.slice(result.starts[1]!, result.starts[1]! + 3)).toBe("<h1");
	});

	test("skips a refused element", () => {
		const source = `const A = () => <div><p className={x}>a</p><p className="m-1">b</p></div>;`;

		const result = editEach(
			source,
			[source.indexOf("<p"), source.lastIndexOf("<p")],
			restyle(() => "m-2"),
		);

		expect(result.starts[0]).toBeNull();
		expect(result.source).toContain(`className={x}`);
		expect(result.source).toContain(`className="m-2"`);
	});

	test("duplicates several elements and returns where the copies are", () => {
		const result = editEach(SOURCE, [H1, P2], duplicateElement);

		expect(result.source.match(/<h1/g)?.length).toBe(2);
		expect(result.source.match(/Two/g)?.length).toBe(2);
		expect(result.source.slice(result.starts[0]!, result.starts[0]! + 3)).toBe("<h1");
		expect(result.source.slice(result.starts[1]!).startsWith(`<p className="text-sm text-muted-foreground">Two`)).toBe(
			true,
		);
		expect(result.starts[1]).toBeGreaterThan(result.source.indexOf("Two"));
	});

	test("removes several elements", () => {
		const result = editEach(SOURCE, [H1, P2], (source, start) => {
			const next = removeElement(source, start);

			return next === null ? null : { source: next, start };
		});

		expect(result.source).not.toContain("Title");
		expect(result.source).not.toContain("Two");
		expect(result.source).toContain("One");
	});
});

describe("shared values", () => {
	test("sharedClasses keeps what every element has", () => {
		expect(sharedClasses(["text-sm p-2 font-bold", "p-2  text-sm", "text-sm p-2 m-1"])).toBe("text-sm p-2");
		expect(sharedClasses([])).toBe("");
	});

	test("commonValue is undefined when the values differ", () => {
		expect(commonValue(["4", "4"])).toBe("4");
		expect(commonValue([null, null])).toBeNull();
		expect(commonValue(["4", null])).toBeUndefined();
	});

	test("retoken applies a shared edit and keeps each element's own classes", () => {
		expect(retoken("text-sm p-2 m-1", "text-sm p-2", "text-sm p-4 underline")).toBe("text-sm m-1 p-4 underline");
		expect(retoken("p-2  text-sm", "text-sm p-2", "text-sm")).toBe("text-sm");
		// Typed as is when the element has just the shared classes
		expect(retoken("a b", "a b", "a b ")).toBe("a b ");
	});
});

describe("wrapping siblings together", () => {
	test("adjacentRange covers adjacent siblings in any order", () => {
		const range = adjacentRange(SOURCE, [P1, H1]);

		expect(range).toEqual({ start: H1, end: at("</p>") + 4 });
	});

	test("adjacentRange refuses gaps, nesting and other parents", () => {
		expect(adjacentRange(SOURCE, [H1, P2])).toBeNull();
		expect(adjacentRange(SOURCE, [H1, DIV])).toBeNull();
		expect(adjacentRange(SOURCE, [SPAN, at("<p", P1 + 1)])).not.toBeNull();
	});

	test("wrapRange wraps the run in one element", () => {
		const range = adjacentRange(SOURCE, [H1, P1])!;
		const result = wrapRange(SOURCE, range, "div", "flex flex-col gap-2");

		expect(result.start).toBe(H1);
		expect(result.source).toContain(`<div className="flex flex-col gap-2">
				<h1 className="text-xl font-bold">Title</h1>
				<p className="text-sm">One</p>
			</div>
			<span>`);
	});
});
