import { expect, test } from "bun:test";
import { elementSpans } from "./spans";

test("elementSpans pairs each element's start with its end", () => {
	const source = `export default function A() {\n\treturn (\n\t\t<div className="p-4">\n\t\t\t<Button>Go</Button>\n\t\t</div>\n\t);\n}\n`;
	const spans = elementSpans(source);
	const slices = [];

	for (let i = 0; i < spans.length; i += 2) slices.push(source.slice(spans[i], spans[i + 1]));

	expect(slices).toEqual([`<div className="p-4">\n\t\t\t<Button>Go</Button>\n\t\t</div>`, "<Button>Go</Button>"]);
});

test("elementSpans is empty for source that doesn't parse", () => {
	expect(elementSpans("export default () => <div")).toEqual([]);
});
