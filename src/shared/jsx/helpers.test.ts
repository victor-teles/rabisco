import { describe, expect, test } from "bun:test";
import { componentSpecifier, exportedNames, resolveModule, rewriteModule } from "./modules";
import { freeIdentifiers, inferType } from "./scope";
import { attrValue, childText, decodeEntities, indentUnit, jsxTextValue, reindent, toPascal, toSentence } from "./text";
import { findElement, parseFile } from "./tree";

describe("text", () => {
	test("entities and JSX whitespace", () => {
		expect(decodeEntities("a &amp; b &#123; &#x7D; &nbsp;&bogus;")).toBe("a & b { }  &bogus;");
		expect(jsxTextValue("\n\t\tHello\n\t\tworld  \n\t")).toBe("Hello world");
		expect(jsxTextValue(" Hi ")).toBe(" Hi ");
	});

	test("attribute and child text forms", () => {
		expect(attrValue("Save")).toBe(`"Save"`);
		expect(attrValue(`Say "hi"`)).toBe(`{"Say \\"hi\\""}`);
		expect(attrValue("&amp;")).toBe(`{"&amp;"}`);
		expect(childText("a < b")).toBe(`{"a < b"}`);
		expect(childText("Plain")).toBe("Plain");
	});

	test("names", () => {
		expect(toPascal("stat card")).toBe("StatCard");
		expect(toPascal("stat-card")).toBe("StatCard");
		expect(toPascal("StatCard")).toBe("StatCard");
		expect(toPascal("Café menu")).toBe("CafeMenu");
		expect(toPascal("2 cols")).toBe("");
		expect(toSentence("StatCard")).toBe("Stat card");
	});

	test("indentation", () => {
		expect(indentUnit("a\n    b\n  c\n")).toBe("  ");
		expect(indentUnit("a\n\tb\n")).toBe("\t");
		expect(indentUnit("a")).toBe("\t");
		expect(reindent("  <a>\n    <b />\n  </a>", "\t", "\t")).toBe("\t<a>\n\t\t<b />\n\t</a>");
	});
});

describe("modules", () => {
	test("resolve and rewrite relative specifiers", () => {
		expect(resolveModule("screens/a.tsx", "../components/card")).toBe("components/card");
		expect(resolveModule("components/a.tsx", "./card.tsx")).toBe("components/card");
		expect(resolveModule("screens/a.tsx", "react")).toBe("react");
		expect(rewriteModule("components/a.tsx", "./card", "components/b.tsx")).toBe("../components/card");
		expect(rewriteModule("screens/a.tsx", "./helpers", "components/b.tsx")).toBe("../screens/helpers");
		expect(componentSpecifier("components/stat-card.tsx")).toBe("../components/stat-card");
	});

	test("exported names", () => {
		expect([
			...exportedNames(
				`export function A() {}\nexport const B = 1;\nexport { C, D as E };\nexport default function F() {}`,
			),
		]).toEqual(["A", "B", "F", "C", "E"]);
	});
});

describe("scope", () => {
	const source = `import { Star } from "lucide-react";
const LIMIT: number = 3;
export function A({ items }: { items: string[] }) {
	const [tab, setTab] = useState<"a" | "b">("a");
	const [count] = useState(0);
	return <div onClick={() => setTab("b")}>{items.map((item, i) => <Star key={i} title={item + tab + count + LIMIT} />)}{Math.max(1, 2)}</div>;
}`;

	const file = parseFile(source);
	const div = findElement(file, source.indexOf("<div"))!;

	test("free identifiers skip what the subtree declares", () => {
		expect(freeIdentifiers(file, div).map((f) => `${f.name}${f.tag ? "<>" : ""}`)).toEqual([
			"setTab",
			"items",
			"Star<>",
			"tab",
			"count",
			"LIMIT",
			"Math",
		]);
	});

	test("types from annotations and useState", () => {
		expect(inferType(file, "tab", div)).toBe(`"a" | "b"`);
		expect(inferType(file, "setTab", div)).toBe(`(value: "a" | "b") => void`);
		expect(inferType(file, "count", div)).toBe("number");
		expect(inferType(file, "LIMIT", div)).toBe("number");
		expect(inferType(file, "items", div)).toBe("any");
	});
});
