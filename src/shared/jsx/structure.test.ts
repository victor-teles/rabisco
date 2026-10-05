import { describe, expect, test } from "bun:test";
import { structureKey, slotsOf, subtreeSize } from "./structure";
import { parseJsx } from "./tree";

const root = (jsx: string) => parseJsx(`const a = ${jsx};`).roots[0]!;

const same = (a: string, b: string) => structureKey(root(a)) === structureKey(root(b));

describe("structureKey", () => {
	test("texts and string attributes may differ; formatting doesn't matter", () => {
		expect(same(`<a href="/a" className="x"><b>Home</b></a>`, `<a href="/b" className="x"><b>\n\tTeam\n</b></a>`)).toBe(
			true,
		);
		expect(same(`<p>{n} items</p>`, `<p>{n} files</p>`)).toBe(true);
	});

	test("classNames, element names, attribute names and expressions must match", () => {
		expect(same(`<p className="a">x</p>`, `<p className="b">x</p>`)).toBe(false);
		expect(same(`<p>x</p>`, `<span>x</span>`)).toBe(false);
		expect(same(`<p title="t">x</p>`, `<p alt="t">x</p>`)).toBe(false);
		expect(same(`<p onClick={a}>x</p>`, `<p onClick={b}>x</p>`)).toBe(false);
		expect(same(`<p>{a}</p>`, `<p>{b}</p>`)).toBe(false);
		expect(same(`<p>x<b /></p>`, `<p>x</p>`)).toBe(false);
		expect(same(`<p {...a}>x</p>`, `<p>x</p>`)).toBe(false);
	});

	test("the root key and comment expressions are ignored", () => {
		expect(same(`<li key={a.id}>x</li>`, `<li key="b">y</li>`)).toBe(true);
		expect(same(`<li>{/* note */}x</li>`, `<li>x</li>`)).toBe(true);
		expect(same(`<ul><li key="a" /></ul>`, `<ul><li key="b" /></ul>`)).toBe(true);
		expect(same(`<ul><li key={a} /></ul>`, `<ul><li key={b} /></ul>`)).toBe(false);
	});
});

describe("slots", () => {
	test("in source order: attributes, then texts and nested elements", () => {
		const element = root(`<a href="/a" className="x" target="_blank">\n\tGo <b title="t">now &amp; here</b>\n</a>`);
		expect(slotsOf(element).map((s) => (s.kind === "attribute" ? `${s.name}=${s.value}` : `text:${s.value}`))).toEqual([
			"href=/a",
			"target=_blank",
			"text:Go",
			"title=t",
			"text:now & here",
		]);
		const [, , go] = slotsOf(element);
		expect(`${go!.start}-${go!.end}`).toBe(
			`${`const a = <a href="/a" className="x" target="_blank">\n\t`.length}-${`const a = <a href="/a" className="x" target="_blank">\n\tGo`.length}`,
		);
	});

	test("subtree size counts elements inside expressions", () => {
		expect(subtreeSize(root(`<ul>{items.map((i) => <li key={i}><b /></li>)}<li /></ul>`))).toBe(4);
	});
});
