import { describe, expect, test } from "bun:test";
import { elementFocus, focusLabel, focusNote, focusOf, lineAt, resolveFocus, resolveFocused } from "./focus";

const SCREEN = `import { Button } from "@/components/ui/button";

export default function Welcome() {
	return (
		<main className="flex flex-col gap-4 p-6">
			<h1 className="text-2xl font-semibold">Welcome back, Ana</h1>
			<section id="pricing" className="grid gap-2">
				<p>Plans</p>
			</section>
			<Button size="lg">Get started</Button>
			<>
				<span />
			</>
		</main>
	);
}
`;

const at = (needle: string) => SCREEN.indexOf(needle);

describe("elementFocus", () => {
	test("offsets, 1-based lines, snippet and label of a component", () => {
		const focus = elementFocus(SCREEN, "screens/welcome.tsx", at("<Button size"))!;
		expect(focus).toEqual({
			file: "screens/welcome.tsx",
			start: at("<Button size"),
			end: at("</Button>") + "</Button>".length,
			startLine: 10,
			endLine: 10,
			snippet: `<Button size="lg">Get started</Button>`,
			label: "<Button> “Get started”",
		});
	});

	test("multi-line elements span their lines; labels use the id, the text, or <> for fragments", () => {
		const section = elementFocus(SCREEN, "s", at("<section"))!;
		expect([section.startLine, section.endLine]).toEqual([7, 9]);
		expect(section.label).toBe("<section#pricing>");
		expect(elementFocus(SCREEN, "s", at("<main"))!.label).toBe("<main>");
		expect(elementFocus(SCREEN, "s", at("<>"))!.label).toBe("<>");
		expect(elementFocus(SCREEN, "s", at("<h1"))!.label).toBe("<h1> “Welcome back, Ana”");
	});

	test("long text is cut", () => {
		const source = `export default function A() { return <p>A sentence that is much longer than a label should be</p> }`;
		expect(elementFocus(source, "s", source.indexOf("<p>"))!.label).toBe("<p> “A sentence that is much…”");
	});

	test("null when nothing starts there or the file doesn't parse", () => {
		expect(elementFocus(SCREEN, "s", at("<Button size") + 1)).toBeNull();
		expect(elementFocus("export default function A() { return <div> }", "s", 37)).toBeNull();
	});

	test("lineAt", () => {
		expect(lineAt("a\nb\nc", 0)).toBe(1);
		expect(lineAt("a\nb\nc", 2)).toBe(2);
		expect(lineAt("a\nb\nc", 4)).toBe(3);
	});
});

describe("focusOf", () => {
	test("from a selected node, or null when its file or element is gone", () => {
		const files = { "screens/welcome.tsx": SCREEN };
		expect(focusOf(files, { file: "screens/welcome.tsx", start: at("<h1") })?.label).toBe("<h1> “Welcome back, Ana”");
		expect(focusOf(files, { file: "screens/other.tsx", start: 0 })).toBeNull();
		expect(focusOf(files, { file: "screens/welcome.tsx", start: 3 })).toBeNull();
		expect(focusOf(files, null)).toBeNull();
	});
});

describe("resolveFocus", () => {
	const focus = elementFocus(SCREEN, "screens/welcome.tsx", at("<Button size"))!;

	test("the same element at the same offset", () => {
		expect(resolveFocus(focus, { "screens/welcome.tsx": SCREEN })).toEqual(focus);
	});

	test("follows the element when the file changed above it", () => {
		const moved = SCREEN.replace("export default", "const x = 1;\n\nexport default");
		const resolved = resolveFocus(focus, { "screens/welcome.tsx": moved })!;
		expect(resolved.snippet).toBe(focus.snippet);
		expect(resolved.start).toBe(moved.indexOf("<Button size"));
		expect(resolved.startLine).toBe(12);
	});

	test("null when the element is gone, ambiguous or the file is missing", () => {
		expect(resolveFocus(focus, { "screens/welcome.tsx": SCREEN.replace("Get started", "Go") })).toBeNull();
		const twice = SCREEN.replace("<>", `<Button size="lg">Get started</Button>\n\t\t\t<>`);
		expect(resolveFocus({ ...focus, start: 0 }, { "screens/welcome.tsx": twice })).toBeNull();
		expect(resolveFocus(focus, {})).toBeNull();
		expect(resolveFocus(undefined, { "screens/welcome.tsx": SCREEN })).toBeNull();
	});
});

describe("resolveFocused", () => {
	const button = elementFocus(SCREEN, "screens/welcome.tsx", at("<Button size"))!;
	const heading = elementFocus(SCREEN, "screens/welcome.tsx", at("<h1"))!;

	test("every element of one file, followed through the changes", () => {
		const moved = SCREEN.replace("export default", "const x = 1;\n\nexport default");
		const resolved = resolveFocused([heading, button], { "screens/welcome.tsx": moved })!;
		expect(resolved.map((element) => element.start)).toEqual([moved.indexOf("<h1"), moved.indexOf("<Button size")]);
	});

	test("null when one is gone, they span files, or there are none", () => {
		const files = { "screens/welcome.tsx": SCREEN.replace("Get started", "Go") };
		expect(resolveFocused([heading, button], files)).toBeNull();
		expect(
			resolveFocused([heading, { ...button, file: "screens/other.tsx" }], { "screens/welcome.tsx": SCREEN }),
		).toBeNull();
		expect(resolveFocused([], { "screens/welcome.tsx": SCREEN })).toBeNull();
		expect(resolveFocused(undefined, { "screens/welcome.tsx": SCREEN })).toBeNull();
	});

	test("focusLabel names one element, and counts several", () => {
		expect(focusLabel([button])).toBe("<Button> “Get started”");
		expect(focusLabel([button, heading])).toBe("2 elements");
	});
});

test("focusNote names the element and ends with the prompt", () => {
	const note = focusNote("<Button>", "Welcome", "make it bigger");
	expect(note).toBe("<Button> in Welcome: make it bigger");
	expect(note.endsWith("make it bigger")).toBe(true);
});
