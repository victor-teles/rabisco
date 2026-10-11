import { describe, expect, test } from "bun:test";
import { commit, createHistory, undo, type History, type Snapshot } from "./history";
import { packHistory, resumeHistory, sameCanvas, unpackHistory } from "./saved-history";
import { aiVersion } from "./versions";
import type { Frame } from "../../shared/types";

const frame = (file: string, x = 0): Frame => ({
	file,
	name: file,
	device: "mobile",
	x,
	y: 0,
	width: 390,
	height: 844,
});

const DESIGN = "# Design\n";

const base: Snapshot = {
	frames: [frame("screens/home.tsx")],
	files: { "DESIGN.md": DESIGN, "screens/home.tsx": "home v1" },
	comments: [],
	theme: { light: {}, dark: {} },
	name: "App",
	device: "mobile",
	locks: [],
	sections: [],
	images: [],
};

const edit = (snapshot: Snapshot, content: string): Snapshot => ({
	...snapshot,
	files: { ...snapshot.files, "screens/home.tsx": content },
});

function steps(count: number): History {
	let history = createHistory(base);

	for (let i = 2; i <= count; i++) history = commit(history, edit(history.present, `home v${i}`));

	return history;
}

const keep = (snapshot: Snapshot) => snapshot;

describe("saved history", () => {
	test("a round trip keeps every step, the redo steps and the versions", () => {
		const history = undo(steps(3));
		const version = aiVersion("v1", "Make it blue", history.present, ["screens/home.tsx"], new Date(0));
		const restored = unpackHistory(packHistory(history, [version], new Date(0)));

		expect(restored.history.past).toEqual(history.past);
		expect(restored.history.present).toEqual(history.present);
		expect(restored.history.future).toEqual(history.future);
		expect(restored.history.coalesceKey).toBeNull();
		expect(restored.versions).toEqual([version]);
	});

	test("file text shared by snapshots is stored once", () => {
		const saved = packHistory(steps(5), [], new Date(0));

		expect(saved.contents.filter((content) => content === DESIGN)).toHaveLength(1);
		expect(saved.contents).toHaveLength(6);
	});

	test("the oldest steps go first when the history is over budget", () => {
		const history = steps(10);
		const saved = packHistory(history, [], new Date(0), 8 * "home v1".length);
		const restored = unpackHistory(saved).history;

		expect(restored.present).toEqual(history.present);
		expect(restored.past.length).toBeLessThan(history.past.length);
		expect(restored.past).toEqual(history.past.slice(history.past.length - restored.past.length));
		expect(saved.contents.join("").length).toBeLessThanOrEqual(8 * "home v1".length);
	});

	test("the present is kept even when it is over budget alone", () => {
		const saved = packHistory(steps(3), [], new Date(0), 1);

		expect(saved.past).toEqual([]);
		expect(unpackHistory(saved).history.present.files["screens/home.tsx"]).toBe("home v3");
	});
});

describe("resuming history", () => {
	test("it is kept as is when nothing changed on disk", () => {
		const history = steps(3);
		const disk = { ...history.present, files: { ...history.present.files } };
		const resumed = resumeHistory(history, disk, keep);

		expect(resumed.dropped).toBe(false);
		expect(resumed.history.present).toBe(disk);
		expect(resumed.history.past).toEqual(history.past);
	});

	test("files edited while the project was closed are folded into every step", () => {
		const history = steps(2);
		const disk = { ...history.present, files: { ...history.present.files, "DESIGN.md": "# Changed\n" } };
		const resumed = resumeHistory(history, disk, keep);

		expect(resumed.dropped).toBe(false);
		expect(resumed.history.past[0]!.files["DESIGN.md"]).toBe("# Changed\n");
		expect(resumed.history.past[0]!.files["screens/home.tsx"]).toBe("home v1");
	});

	test("a canvas changed outside Rabisco drops the steps", () => {
		const history = steps(3);
		const disk = { ...history.present, frames: [frame("screens/home.tsx", 400)] };
		const resumed = resumeHistory(history, disk, keep);

		expect(resumed.dropped).toBe(true);
		expect(resumed.history).toEqual(createHistory(disk));
	});

	test("nothing counts as dropped when there were no steps", () => {
		const history = createHistory(base);

		expect(resumeHistory(history, { ...base, name: "Renamed" }, keep).dropped).toBe(false);
	});

	test("the canvas comparison ignores key order and missing lists", () => {
		const reordered: Snapshot = {
			...base,
			frames: [
				{ y: 0, x: 0, file: "screens/home.tsx", name: "screens/home.tsx", device: "mobile", width: 390, height: 844 },
			],
			locks: undefined,
		};

		expect(sameCanvas(base, reordered)).toBe(true);
		expect(sameCanvas(base, { ...base, name: "Other" })).toBe(false);
	});
});
