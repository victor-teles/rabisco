import { describe, expect, test } from "bun:test";
import { ancestorsOf, siblingStart } from "./element-nav";

const SOURCE = `export default function Screen() {
	return (
		<main>
			<Card>
				<h2>Title</h2>
				<>
					<p>One</p>
					<p>Two</p>
				</>
				{items.map((item) => <span key={item}>{item}</span>)}
			</Card>
			<footer />
		</main>
	);
}
`;

const at = (text: string) => {
	const index = SOURCE.indexOf(text);

	if (index === -1) throw new Error(`${text} isn't in the source`);

	return index;
};

describe("ancestorsOf", () => {
	test("lists the selectable ancestors outermost first, skipping fragments", () => {
		expect(ancestorsOf(SOURCE, at("<p>Two"))).toEqual([
			{ start: at("<main>"), name: "main", component: false },
			{ start: at("<Card>"), name: "Card", component: true },
		]);
	});

	test("is empty for a root and for an offset that isn't an element", () => {
		expect(ancestorsOf(SOURCE, at("<main>"))).toEqual([]);
		expect(ancestorsOf(SOURCE, at("Title"))).toEqual([]);
	});
});

describe("siblingStart", () => {
	test("walks siblings through fragments and expressions, in source order", () => {
		expect(siblingStart(SOURCE, at("<h2>"), 1)).toBe(at("<p>One"));
		expect(siblingStart(SOURCE, at("<p>One"), 1)).toBe(at("<p>Two"));
		expect(siblingStart(SOURCE, at("<p>Two"), 1)).toBe(at("<span"));
		expect(siblingStart(SOURCE, at("<p>One"), -1)).toBe(at("<h2>"));
	});

	test("wraps around, like Tab in Figma", () => {
		expect(siblingStart(SOURCE, at("<span"), 1)).toBe(at("<h2>"));
		expect(siblingStart(SOURCE, at("<h2>"), -1)).toBe(at("<span"));
		expect(siblingStart(SOURCE, at("<footer"), 1)).toBe(at("<Card>"));
	});

	test("is null for a root, an only child, or a missing element", () => {
		expect(siblingStart(SOURCE, at("<main>"), 1)).toBeNull();
		expect(siblingStart("const a = <div><b /></div>;", 15, 1)).toBeNull();
		expect(siblingStart(SOURCE, 1, 1)).toBeNull();
	});
});
