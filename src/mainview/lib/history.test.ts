import { describe, expect, test } from "bun:test";
import type { CanvasComment, Frame } from "../../shared/types";
import {
	applyFileChanges,
	canRedo,
	canUndo,
	commit,
	createHistory,
	diffFiles,
	nextSnapshot,
	rebase,
	redo,
	seal,
	undo,
	type Snapshot,
} from "./history";

const frame = (file: string, x = 0): Frame => ({
	file,
	name: file,
	device: "mobile",
	x,
	y: 0,
	width: 390,
	height: 844,
});

const snap = (files: Record<string, string>, frames: Frame[] = []): Snapshot => ({ files, frames });

describe("history", () => {
	test("commit, undo and redo", () => {
		const a = snap({ "screens/a.tsx": "a" });
		const b = snap({ "screens/a.tsx": "b" });
		let h = commit(createHistory(a), b);
		expect(canUndo(h)).toBe(true);
		h = undo(h);
		expect(h.present).toBe(a);
		expect(canRedo(h)).toBe(true);
		h = redo(h);
		expect(h.present).toBe(b);
		expect(canRedo(h)).toBe(false);
	});

	test("undo/redo at the ends are no-ops", () => {
		const h = createHistory(snap({}));
		expect(undo(h)).toBe(h);
		expect(redo(h)).toBe(h);
	});

	test("committing the same snapshot adds no step", () => {
		const h = createHistory(snap({}));
		expect(commit(h, h.present)).toBe(h);
	});

	test("a new commit clears redo", () => {
		let h = commit(createHistory(snap({ a: "1" })), snap({ a: "2" }));
		h = undo(h);
		h = commit(h, snap({ a: "3" }));
		expect(canRedo(h)).toBe(false);
		expect(h.past.length).toBe(1);
	});

	test("same coalesce key amends one step until sealed", () => {
		const start = snap({}, [frame("screens/a.tsx", 0)]);
		let h = createHistory(start);

		for (let x = 1; x <= 5; x++) h = commit(h, snap({}, [frame("screens/a.tsx", x)]), { coalesce: "drag:1" });
		expect(h.past.length).toBe(1);
		expect(h.present.frames[0]!.x).toBe(5);
		h = commit(h, snap({}, [frame("screens/a.tsx", 9)]), { coalesce: "drag:2" });
		expect(h.past.length).toBe(2);
		h = seal(h);
		h = commit(h, snap({}, [frame("screens/a.tsx", 10)]), { coalesce: "drag:2" });
		expect(h.past.length).toBe(3);
		expect(undo(undo(undo(h))).present).toBe(start);
	});

	test("undo ends coalescing", () => {
		let h = commit(createHistory(snap({ a: "0" })), snap({ a: "1" }), { coalesce: "k" });
		h = commit(h, snap({ a: "2" }), { coalesce: "k" });
		h = undo(h);
		h = commit(h, snap({ a: "3" }), { coalesce: "k" });
		expect(h.past.length).toBe(1);
		expect(h.past[0]!.files.a).toBe("0");
	});

	test("history is capped", () => {
		let h = createHistory(snap({ n: "0" }));

		for (let i = 1; i <= 10; i++) h = commit(h, snap({ n: String(i) }), { limit: 4 });
		expect(h.past.length).toBe(4);
		expect(h.past[0]!.files.n).toBe("6");
	});
});

describe("file diffs", () => {
	test("applyFileChanges writes and deletes", () => {
		expect(
			applyFileChanges({ a: "1", b: "2" }, [
				{ path: "a", content: null },
				{ path: "c", content: "3" },
			]),
		).toEqual({ b: "2", c: "3" });
	});

	test("diffFiles round-trips", () => {
		const from = { a: "1", b: "2", c: "3" };
		const to = { a: "1", b: "x", d: "4" };
		const changes = diffFiles(from, to);
		expect(changes).toEqual([
			{ path: "b", content: "x" },
			{ path: "c", content: null },
			{ path: "d", content: "4" },
		]);
		expect(applyFileChanges(from, changes)).toEqual(to);
		expect(diffFiles(to, to)).toEqual([]);
	});
});

describe("rebase (external edits)", () => {
	test("an external edit survives undo and redo", () => {
		let h = createHistory(snap({ "screens/a.tsx": "v1" }, [frame("screens/a.tsx")]));
		h = commit(h, snap(h.present.files, [frame("screens/a.tsx", 50)]));
		h = rebase(h, [{ path: "screens/a.tsx", content: "external" }]);
		expect(h.present.files["screens/a.tsx"]).toBe("external");
		h = undo(h);
		expect(h.present.files["screens/a.tsx"]).toBe("external");
		expect(h.present.frames[0]!.x).toBe(0);
		h = redo(h);
		expect(h.present.files["screens/a.tsx"]).toBe("external");
	});

	test("editing a file created by a step: undoing that step still removes it", () => {
		let h = createHistory(snap({}));
		h = commit(h, snap({ "screens/new.tsx": "gen" }));
		h = rebase(h, [{ path: "screens/new.tsx", content: "tweaked" }]);
		h = undo(h);
		expect(h.present.files).toEqual({});
		h = redo(h);
		expect(h.present.files["screens/new.tsx"]).toBe("tweaked");
	});

	test("external creations and deletions apply to every snapshot", () => {
		let h = createHistory(snap({ "screens/a.tsx": "a" }));
		h = commit(h, snap({ "screens/a.tsx": "a2" }));
		h = rebase(h, [
			{ path: "screens/a.tsx", content: null },
			{ path: "screens/b.tsx", content: "b" },
		]);
		h = undo(h);
		expect(h.present.files).toEqual({ "screens/b.tsx": "b" });
	});

	test("reconcile runs on every snapshot", () => {
		let h = createHistory(snap({ "screens/a.tsx": "a" }, [frame("screens/a.tsx")]));
		h = commit(
			h,
			snap({ "screens/a.tsx": "a", "screens/b.tsx": "b" }, [frame("screens/a.tsx"), frame("screens/b.tsx", 500)]),
		);
		h = rebase(h, [{ path: "screens/a.tsx", content: null }], (s) => ({
			...s,
			frames: s.frames.filter((f) => f.file in s.files),
		}));
		expect(h.present.frames.map((f) => f.file)).toEqual(["screens/b.tsx"]);
		expect(h.past[0]!.frames).toEqual([]);
	});

	test("no changes is a no-op", () => {
		const h = createHistory(snap({}));
		expect(rebase(h, [])).toBe(h);
	});
});

describe("comments in the history", () => {
	const pin = (id: string, rest: Partial<CanvasComment> = {}): CanvasComment => ({
		id,
		x: 5,
		y: 5,
		text: id,
		createdAt: "t",
		...rest,
	});

	test("recipes that leave comments out keep the present ones", () => {
		const present = { ...snap({}, [frame("screens/a.tsx")]), comments: [pin("1")] };
		const next = nextSnapshot(present, { files: { a: "1" }, frames: present.frames });
		expect(next.comments).toBe(present.comments);
	});

	test("an unchanged recipe result is the present", () => {
		const present = { ...snap({}), comments: [pin("1")] };
		expect(nextSnapshot(present, present)).toBe(present);
	});

	test("deleting a frame detaches its pins; undo puts them back on the frame", () => {
		const a = frame("screens/a.tsx", 100);
		const start = { ...snap({ "screens/a.tsx": "a" }, [a]), comments: [pin("1", { file: a.file })] };
		let h = createHistory(start);
		h = commit(h, nextSnapshot(h.present, { frames: [], files: {} }));
		expect(h.present.comments).toEqual([{ id: "1", x: 105, y: 5, text: "1", createdAt: "t" }]);
		h = undo(h);
		expect(h.present.comments![0]!.file).toBe("screens/a.tsx");
	});

	test("adding, editing and resolving are steps; a typing burst is one", () => {
		let h = createHistory({ ...snap({}), comments: [] });
		h = commit(h, nextSnapshot(h.present, { ...h.present, comments: [pin("1")] }));

		for (const text of ["H", "He", "Hey"]) {
			h = commit(h, nextSnapshot(h.present, { ...h.present, comments: [pin("1", { text })] }), {
				coalesce: "comment-text:1",
			});
		}

		h = seal(h);
		h = commit(h, nextSnapshot(h.present, { ...h.present, comments: [pin("1", { text: "Hey", resolved: true })] }));
		expect(h.past.length).toBe(3);
		h = undo(h);
		expect(h.present.comments![0]).toEqual(pin("1", { text: "Hey" }));
		h = undo(h);
		expect(h.present.comments![0]!.text).toBe("1");
		h = undo(h);
		expect(h.present.comments).toEqual([]);
	});
});
