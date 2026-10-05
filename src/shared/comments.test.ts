import { describe, expect, test } from "bun:test";
import { detachComments, normalizeComments, pinAt, pinPosition } from "./comments";
import { reconcileFrames, emptyCanvas } from "./project";
import type { CanvasComment, Frame } from "./types";

const frame = (file: string, x: number, y = 0): Frame => ({ file, name: file, device: "mobile", x, y, width: 390, height: 844 });
const comment = (id: string, rest: Partial<CanvasComment> = {}): CanvasComment => ({ id, x: 10, y: 20, text: "Hi", createdAt: "t", ...rest });

describe("normalizeComments", () => {
	test("old projects have none", () => {
		expect(normalizeComments(undefined)).toEqual([]);
		expect(normalizeComments({})).toEqual([]);
	});

	test("drops malformed entries, duplicate ids and bad replies", () => {
		const raw = [
			{ id: "a", x: 1, y: 2, text: "ok", createdAt: "t", resolved: true, file: "screens/a.tsx", extra: 1 },
			{ id: "a", x: 1, y: 2, text: "duplicate" },
			{ id: "b", x: "1", y: 2, text: "bad x" },
			{ id: "c", x: 1, y: Number.NaN, text: "bad y" },
			{ x: 1, y: 2, text: "no id" },
			{ id: "d", x: 1, y: 2 },
			null,
			{ id: "e", x: 0, y: 0, text: "", file: "", resolved: "yes", replies: [{ id: "r", text: "re", createdAt: "t" }, { id: 3 }] },
		];
		expect(normalizeComments(raw)).toEqual([
			{ id: "a", file: "screens/a.tsx", x: 1, y: 2, text: "ok", createdAt: "t", resolved: true },
			{ id: "e", x: 0, y: 0, text: "", createdAt: "", replies: [{ id: "r", text: "re", createdAt: "t" }] },
		]);
	});
});

describe("pins", () => {
	const frames = [frame("screens/a.tsx", 0), frame("screens/b.tsx", 200, 100)];

	test("a point on a frame is stored relative to the topmost frame", () => {
		expect(pinAt({ x: 250.4, y: 150.6 }, frames)).toEqual({ file: "screens/b.tsx", x: 50, y: 51 });
		expect(pinAt({ x: 50, y: 50 }, frames)).toEqual({ file: "screens/a.tsx", x: 50, y: 50 });
	});

	test("a point outside every frame is a canvas pin", () => {
		expect(pinAt({ x: -40, y: 5 }, frames)).toEqual({ x: -40, y: 5 });
	});

	test("a frame pin moves with its frame; an orphan has no position", () => {
		expect(pinPosition({ file: "screens/b.tsx", x: 5, y: 5 }, frames)).toEqual({ x: 205, y: 105 });
		expect(pinPosition({ x: 5, y: 5 }, frames)).toEqual({ x: 5, y: 5 });
		expect(pinPosition({ file: "screens/gone.tsx", x: 5, y: 5 }, frames)).toBeNull();
	});
});

describe("detachComments", () => {
	test("pins on a removed frame stay where they were, on the canvas", () => {
		const before = [frame("screens/a.tsx", 100, 50), frame("screens/b.tsx", 600)];
		const after = [before[1]!];
		const comments = [comment("1", { file: "screens/a.tsx" }), comment("2", { file: "screens/b.tsx" }), comment("3")];
		const next = detachComments(comments, before, after);
		expect(next[0]).toEqual({ id: "1", x: 110, y: 70, text: "Hi", createdAt: "t" });
		expect(next[1]).toBe(comments[1]!);
		expect(next[2]).toBe(comments[2]!);
	});

	test("unchanged when no pinned frame went away", () => {
		const comments = [comment("1", { file: "screens/a.tsx" })];
		expect(detachComments(comments, [frame("screens/a.tsx", 0)], [frame("screens/a.tsx", 40)])).toBe(comments);
	});

	test("reconcileFrames detaches pins of frames whose file is gone", () => {
		const canvas = { ...emptyCanvas("x", "mobile"), frames: [frame("screens/a.tsx", 100)], comments: [comment("1", { file: "screens/a.tsx" })] };
		const next = reconcileFrames(canvas, {});
		expect(next.frames).toEqual([]);
		expect(next.comments).toEqual([{ id: "1", x: 110, y: 20, text: "Hi", createdAt: "t" }]);
	});
});
