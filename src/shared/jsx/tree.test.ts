import { describe, expect, test } from "bun:test";
import { ANALYTICS, DASHBOARD } from "./test-fixtures";
import { elementAt, elementCount, findElement, flatten, parseJsx, walk } from "./tree";

const at = (source: string, needle: string, from = 0) => source.indexOf(needle, from);

describe("parseJsx", () => {
	test("finds roots in every function, with nested elements in source order", () => {
		const tree = parseJsx(DASHBOARD);
		expect(tree.ok).toBe(true);
		expect(tree.roots.map((root) => root.name)).toEqual(["header", "div"]);
		const names = flatten(tree).map((e) => e.name);
		expect(names.slice(0, 4)).toEqual(["header", "h1", "Button", "Bell"]);
		expect(names).toContain("li");
		expect(names).toContain("TabBar");
	});

	test("generics, arrow generics, comments and strings with < > { are not JSX", () => {
		const tree = parseJsx(DASHBOARD);
		expect(flatten(tree).some((e) => e.name === "string" || e.name === "T")).toBe(false);
	});

	test("spans, names and self-closing", () => {
		const tree = parseJsx(DASHBOARD);
		const bell = findElement(tree, at(DASHBOARD, "<Bell"))!;
		expect(DASHBOARD.slice(bell.start, bell.end)).toBe('<Bell className="size-5" />');
		expect(bell.selfClosing).toBe(true);
		expect(bell.intrinsic).toBe(false);
		expect(bell.closingStart).toBeNull();
		const h1 = findElement(tree, at(DASHBOARD, "<h1"))!;
		expect(DASHBOARD.slice(h1.start, h1.end)).toBe('<h1 className="text-xl font-semibold">{title}</h1>');
		expect(DASHBOARD.slice(h1.start, h1.openingEnd)).toBe('<h1 className="text-xl font-semibold">');
		expect(DASHBOARD.slice(h1.closingStart!, h1.end)).toBe("</h1>");
		expect(DASHBOARD.slice(h1.start, h1.nameEnd)).toBe("<h1");
		expect(h1.intrinsic).toBe(true);
		expect(h1.parent?.name).toBe("header");
		expect(h1.depth).toBe(1);
	});

	test("attributes: strings, expressions, booleans and spreads", () => {
		const source = `const a = <input className="a &amp; b" disabled value={x ? "y" : "z"} {...rest} data-x='q' />;`;
		const [input] = parseJsx(source).roots;
		expect(input!.attributes.map((a) => (a.kind === "spread" ? `...${a.text}` : a.name))).toEqual([
			"className",
			"disabled",
			"value",
			"......rest",
			"data-x",
		]);
		const [className, disabled, value] = input!.attributes;
		expect(className).toMatchObject({ value: { kind: "string", value: "a & b", raw: '"a &amp; b"' } });
		expect(disabled).toMatchObject({ value: null });
		expect(value).toMatchObject({ value: { kind: "expression", text: 'x ? "y" : "z"' } });
		expect(source.slice(value!.start, value!.end)).toBe('value={x ? "y" : "z"}');
	});

	test("elements inside expressions are descendants with their container", () => {
		const tree = parseJsx(DASHBOARD);
		const li = findElement(tree, at(DASHBOARD, "<li"))!;
		expect(li.parent?.name).toBe("ul");
		expect(li.container?.text).toContain("ORDERS.map");
		const hint = findElement(tree, at(DASHBOARD, '<p className="px-5'))!;
		expect(hint.container?.text).toStartWith("open &&");
		const icon = parseJsx(`<Button icon={<Star />}>Go</Button>`).roots[0]!;
		const star = flatten(icon)[1]!;
		expect(star.name).toBe("Star");
		expect(star.parent).toBe(icon);
		expect(star.container?.kind).toBe("expression");
	});

	test("children: texts with rendered values, expressions, fragments and member names", () => {
		const source = `const x = (
	<>
		<Card.Header>
			Hello &amp;
			world {name}
		</Card.Header>
		{/* note */}
	</>
);`;

		const [fragment] = parseJsx(source).roots;
		expect(fragment!.name).toBeNull();
		const header = fragment!.children.find((c) => c.kind === "element");

		if (header?.kind !== "element") throw new Error("no element child");
		expect(header.name).toBe("Card.Header");
		const [text, expression] = header.children;
		expect(text).toMatchObject({ kind: "text", value: "Hello & world " });
		expect(expression).toMatchObject({ kind: "expression", text: "name", empty: false });
		expect(fragment!.children.find((c) => c.kind === "expression")).toMatchObject({ empty: true });
	});

	test("bad input never throws", () => {
		expect(parseJsx("const a = <div>")).toMatchObject({ ok: false, roots: [] });
		expect(parseJsx("")).toMatchObject({ ok: true, roots: [] });
		expect(parseJsx("export const n = 1 < 2;").roots).toEqual([]);
	});
});

describe("lookup", () => {
	const tree = parseJsx(ANALYTICS);

	test("elementAt returns the deepest element", () => {
		expect(elementAt(tree, at(ANALYTICS, "Visitors"))?.name).toBe("p");
		expect(elementAt(tree, at(ANALYTICS, "<CardContent"))?.name).toBe("CardContent");
		expect(elementAt(tree, 0)).toBeNull();
	});

	test("findElement matches the start exactly", () => {
		expect(findElement(tree, at(ANALYTICS, "<Card "))?.name).toBe("Card");
		expect(findElement(tree, at(ANALYTICS, "<Card ") + 1)).toBeNull();
	});

	test("walk can skip subtrees; counts include nested elements", () => {
		const visited: string[] = [];
		walk(tree, (e) => {
			visited.push(e.name!);

			if (e.name === "Card") return false;
		});
		expect(visited).toEqual(["main", "Card", "Card"]);
		expect(elementCount(tree.roots[0]!)).toBe(9);
	});
});
