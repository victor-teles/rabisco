import { describe, expect, test } from "bun:test";
import type { Frame } from "../../shared/types";
import { contextSelection, marqueeSelection, sameSelection, selectedFrames, toggleInSelection } from "./selection";
import { tokenizeLines } from "./highlight";

const frame = (file: string, x: number): Frame => ({
	file,
	name: file,
	device: "mobile",
	x,
	y: 0,
	width: 100,
	height: 100,
});

const frames = [frame("a", 0), frame("b", 200), frame("c", 400)];

describe("selection", () => {
	test("toggle", () => {
		expect(toggleInSelection(["a"], "b")).toEqual(["a", "b"]);
		expect(toggleInSelection(["a", "b"], "a")).toEqual(["b"]);
	});

	test("marquee replaces, or adds with shift", () => {
		const marquee = { x: 150, y: 50, width: 300, height: 10 };
		expect(marqueeSelection(frames, marquee, ["a"], false)).toEqual(["b", "c"]);
		expect(marqueeSelection(frames, marquee, ["a", "b"], true)).toEqual(["a", "b", "c"]);
		expect(marqueeSelection(frames, { x: 120, y: 0, width: 50, height: 50 }, [], false)).toEqual([]);
	});

	test("selectedFrames keeps canvas order and drops unknown files", () => {
		expect(selectedFrames(frames, ["c", "zzz", "a"]).map((f) => f.file)).toEqual(["a", "c"]);
	});

	test("sameSelection", () => {
		expect(sameSelection(["a", "b"], ["a", "b"])).toBe(true);
		expect(sameSelection(["a"], ["b"])).toBe(false);
	});

	test("right-click acts on the selection holding the screen, else on the screen alone", () => {
		const selection = ["a", "c"];
		expect(contextSelection(selection, "c")).toBe(selection);
		expect(contextSelection(selection, "b")).toEqual(["b"]);
		expect(contextSelection([], "a")).toEqual(["a"]);
		expect(contextSelection(["components/card.tsx"], "a")).toEqual(["a"]);
	});
});

describe("highlight", () => {
	test("keeps every character and splits lines", () => {
		const source =
			'import { Button } from "@/components/ui/button";\n/* a\nb */\nexport default function A() {\n\treturn <Button size="sm">{`x\ny`}</Button>;\n}';

		const lines = tokenizeLines(source);
		expect(lines.map((line) => line.map((t) => t.text).join("")).join("\n")).toBe(source);
		expect(lines[0]![0]).toEqual({ kind: "keyword", text: "import" });
		expect(lines[1]!.every((t) => t.kind === "comment")).toBe(true);
		expect(lines[4]!.some((t) => t.kind === "tag" && t.text === "<Button")).toBe(true);
		expect(lines[4]!.some((t) => t.kind === "attr" && t.text === "size")).toBe(true);
	});
});
