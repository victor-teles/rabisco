import { describe, expect, test } from "bun:test";
import type { Json } from "../json";
import { MAX_CAPTURED_NODES, parseCapturedTree } from "./captured-tree";

const box = { x: 0, y: 0, width: 10, height: 10 };

const json = (root: Json, extra: Record<string, Json> = {}) =>
	JSON.stringify({ title: "Page", width: 800, root, ...extra });

describe("parseCapturedTree", () => {
	test("keeps known styles, safe attributes and token bindings", () => {
		const tree = parseCapturedTree(
			json({
				tag: "body",
				box,
				styles: { color: "rgb(0, 0, 0)", cursor: "pointer" },
				children: [
					{
						tag: "a",
						box,
						styles: {},
						tokens: { "background-color": "color-brand", color: "Not a token!" },
						attrs: { href: "javascript:alert(1)", onclick: "x()", "aria-label": "Home" },
						children: [{ tag: "#text", text: "Home", box }],
					},
				],
			}),
		);

		expect(tree?.root.styles).toEqual({ color: "rgb(0, 0, 0)" });
		const link = tree?.root.children[0];

		expect(link?.attrs).toEqual({ "aria-label": "Home" });
		expect(link?.tokens).toEqual({ "background-color": "color-brand" });
		expect(link?.children[0]?.text).toBe("Home");
	});

	test("drops script-like tags, CSS injection and bad boxes", () => {
		const tree = parseCapturedTree(
			json({
				tag: "body",
				box,
				styles: { color: "red;} body{x:y" },
				children: [
					{ tag: "script", box, styles: {}, children: [] },
					{ tag: "div", box: { x: 0 }, styles: {}, children: [] },
					{ tag: "img", box, styles: {}, attrs: { src: "data:image/png;base64,AAA" }, children: [] },
				],
			}),
		);

		expect(tree?.root.styles).toEqual({});
		expect(tree?.root.children.map((node) => node.tag)).toEqual(["img"]);
		expect(tree?.root.children[0]?.attrs?.src).toBe("data:image/png;base64,AAA");
	});

	test("caps the node count", () => {
		const children = Array.from({ length: MAX_CAPTURED_NODES + 50 }, () => ({
			tag: "div",
			box,
			styles: {},
			children: [],
		}));

		const tree = parseCapturedTree(json({ tag: "body", box, styles: {}, children }));

		expect(tree?.root.children.length).toBe(MAX_CAPTURED_NODES - 1);
	});

	test("rejects input that isn't a tree", () => {
		expect(parseCapturedTree("not json")).toBeNull();
		expect(parseCapturedTree(json({ tag: "body", box, styles: {}, children: [] }, { width: 0 }))).toBeNull();
		expect(parseCapturedTree(JSON.stringify([]))).toBeNull();
	});
});
