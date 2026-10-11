import { describe, expect, test } from "bun:test";
import { emptyCanvas } from "../../shared/project";
import type { CanvasDoc, Frame } from "../../shared/types";
import { rebaseCanvas } from "./canvas-rebase";
import { commit, createHistory, undo, type Snapshot } from "./history";

const frame = (file: string, x = 0): Frame => ({
	file,
	name: file,
	device: "mobile",
	x,
	y: 0,
	width: 390,
	height: 844,
});

const canvas = (patch: Partial<CanvasDoc>): CanvasDoc => ({ ...emptyCanvas("App", "mobile"), ...patch });

const snap = (frames: Frame[], patch: Partial<Snapshot> = {}): Snapshot => ({ files: {}, frames, ...patch });

describe("rebaseCanvas", () => {
	test("an unchanged canvas keeps the history", () => {
		const history = createHistory(snap([frame("a")]));
		const disk = canvas({ frames: [frame("a")] });

		expect(rebaseCanvas(history, disk, { ...disk, frames: [{ ...frame("a") }] })).toBe(history);
	});

	test("key order alone is no change", () => {
		const history = createHistory(snap([frame("a")]));
		const { file, name, device, x, y, width, height } = frame("a");

		const reordered = canvas({ frames: [{ height, width, y, x, device, name, file }] });

		expect(rebaseCanvas(history, canvas({ frames: [frame("a")] }), reordered)).toBe(history);
	});

	test("moved, added and removed frames land in every snapshot; local moves of other frames stay", () => {
		const base = snap([frame("a"), frame("b"), frame("d")]);
		const moved = snap([frame("a"), frame("b"), frame("d", 300)]);
		const history = commit(createHistory(base), moved);
		const from = canvas({ frames: [frame("a"), frame("b"), frame("d")] });
		const to = canvas({ frames: [frame("a", 900), frame("d"), frame("c", 50)] });

		const rebased = rebaseCanvas(history, from, to);

		expect(rebased.present.frames).toEqual([frame("a", 900), frame("d", 300), frame("c", 50)]);
		expect(rebased.past[0]!.frames).toEqual([frame("a", 900), frame("d"), frame("c", 50)]);
		expect(undo(rebased).present.frames).toEqual([frame("a", 900), frame("d"), frame("c", 50)]);
		expect(rebased.coalesceKey).toBeNull();
	});

	test("name, theme, comments and sections follow the file", () => {
		const comment = { id: "c1", x: 1, y: 2, text: "Hi", createdAt: "2026-01-01" };
		const section = { id: "s1", name: "Flow", color: "blue" as const, x: 0, y: 0, width: 10, height: 10 };
		const history = createHistory(snap([], { name: "App", comments: [comment], sections: [] }));
		const from = canvas({ comments: [comment] });

		const to = canvas({
			name: "Renamed",
			comments: [{ ...comment, resolved: true }],
			sections: [section],
		});

		const { present } = rebaseCanvas(history, from, to);

		expect(present.name).toBe("Renamed");
		expect(present.comments).toEqual([{ ...comment, resolved: true }]);
		expect(present.sections).toEqual([section]);
	});

	test("reconcile runs on every folded snapshot", () => {
		const history = commit(createHistory(snap([])), snap([frame("a")]));
		const seen: number[] = [];

		rebaseCanvas(history, canvas({ name: "A" }), canvas({ name: "B" }), (snapshot) => {
			seen.push(snapshot.frames.length);

			return snapshot;
		});

		expect(seen.sort()).toEqual([0, 1]);
	});
});
