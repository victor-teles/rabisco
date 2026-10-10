import { describe, expect, test } from "bun:test";
import { matchingStarts } from "./matching";

const SOURCE = `export default function Screen() {
	return (
		<main className="p-4">
			<Card title="One" />
			<h2 className="text-lg font-semibold">A</h2>
			<p className="font-semibold text-lg">B</p>
			<section>
				<Card title="Two" />
				<h2 className="text-lg">C</h2>
				<span>D</span>
			</section>
			<span>E</span>
			<span className={cn("text-lg", active && "underline")}>F</span>
		</main>
	);
}
`;

const at = (text: string, from = 0) => SOURCE.indexOf(text, from);

describe("matchingStarts", () => {
	test("a component matches every use of it in the screen", () => {
		expect(matchingStarts(SOURCE, at("<Card"))).toEqual([at("<Card"), at('<Card title="Two"')]);
	});

	test("an element matches the elements with the same classes, in any order and tag", () => {
		expect(matchingStarts(SOURCE, at("<h2"))).toEqual([at("<h2"), at("<p")]);
	});

	test("an element without classes matches the same tag without classes", () => {
		expect(matchingStarts(SOURCE, at("<span"))).toEqual([at("<span"), at("<span>E")]);
	});

	test("nothing for a missing element", () => {
		expect(matchingStarts(SOURCE, 3)).toEqual([]);
		expect(matchingStarts("<div", 0)).toEqual([]);
	});
});
