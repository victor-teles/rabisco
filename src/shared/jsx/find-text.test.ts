import { describe, expect, test } from "bun:test";
import { findInFiles, findText, jsxTextOf, replaceText } from "./find-text";

const SOURCE = `export default function Screen() {
	return (
		<main className="p-4">
			<h1>Welcome back, Ana</h1>
			<p>{"Welcome to the app"}</p>
			<Button label="Welcome">Sign in</Button>
			<span>{user.name} says welcome</span>
			<p>{\`Welcome \${user.name}\`}</p>
			<p>Fish &amp; chips, welcome</p>
			<style>{".welcome {}"}</style>
		</main>
	);
}
`;

const at = (text: string, from = 0) => SOURCE.indexOf(text, from);

describe("findText", () => {
	test("finds JSX text and string literal children, ignoring case, in source order", () => {
		const matches = findText(SOURCE, "welcome");

		expect(matches.map((match) => match.element)).toEqual([
			at("<h1>"),
			at('<p>{"Welcome'),
			at("<span>"),
			at("<p>Fish"),
		]);
		expect(matches[0]).toMatchObject({ before: "", text: "Welcome", after: " back, Ana" });
		expect(matches[2]).toMatchObject({ before: "says ", text: "welcome", after: "" });
	});

	test("attributes, template literals with interpolation and <style> are left out", () => {
		expect(findText(SOURCE, "Sign in").length).toBe(1);
		expect(findText(SOURCE, "label")).toEqual([]);
		expect(findText(SOURCE, ".welcome")).toEqual([]);
	});

	test("matching case, an empty query and broken source find nothing extra", () => {
		expect(findText(SOURCE, "welcome", { caseSensitive: true }).length).toBe(2);
		expect(findText(SOURCE, "")).toEqual([]);
		expect(findText("<div>Welcome", "Welcome")).toEqual([]);
	});

	test("text React would render differently than written is skipped", () => {
		expect(findText(SOURCE, "Fish & chips")).toEqual([]);
		expect(findText("const A = () => <p>Hello\n\t\tworld</p>;", "Hello world")).toEqual([]);
	});

	test("results are grouped by file, in the order given", () => {
		const files = { "screens/a.tsx": SOURCE, "screens/b.tsx": "const B = () => <p>Nothing</p>;" };

		expect(findInFiles(files, ["screens/b.tsx", "screens/a.tsx", "screens/gone.tsx"], "welcome")).toEqual([
			{ file: "screens/a.tsx", matches: findText(SOURCE, "welcome") },
		]);
	});
});

describe("replaceText", () => {
	test("replaces every match, rewriting literals as strings and escaping JSX text", () => {
		const next = replaceText(SOURCE, "welcome", "Hi {there}");

		expect(next).toContain("<h1>Hi &#123;there&#125; back, Ana</h1>");
		expect(next).toContain('<p>{"Hi {there} to the app"}</p>');
		expect(next).toContain("<span>{user.name} says Hi &#123;there&#125;</span>");
		expect(next).toContain('<Button label="Welcome">Sign in</Button>');
		expect(next).toContain("{`Welcome ${user.name}`}");
		expect(findText(next, "welcome")).toEqual([]);
	});

	test("replaces only the chosen matches", () => {
		const [first, , third] = findText(SOURCE, "welcome");
		const next = replaceText(SOURCE, "welcome", "Hello", {}, new Set([first!.at, third!.at]));

		expect(next).toContain("<h1>Hello back, Ana</h1>");
		expect(next).toContain('<p>{"Welcome to the app"}</p>');
		expect(next).toContain("says Hello</span>");
	});

	test("several matches in one literal or text node", () => {
		const source = `const A = () => (\n\t<div>\n\t\t<p>a-a-a</p>\n\t\t<p>{'a a'}</p>\n\t</div>\n);\n`;

		expect(replaceText(source, "a", "bb")).toContain("<p>bb-bb-bb</p>");
		expect(replaceText(source, "a", "bb")).toContain('<p>{"bb bb"}</p>');
	});

	test("no match leaves the source as it is", () => {
		expect(replaceText(SOURCE, "missing", "x")).toBe(SOURCE);
		expect(replaceText(SOURCE, "welcome", "x", {}, new Set())).toBe(SOURCE);
	});

	test("JSX text escaping", () => {
		expect(jsxTextOf("a < b & {c} > d")).toBe("a &#60; b &#38; &#123;c&#125; &#62; d");
	});
});
