import { describe, expect, test } from "bun:test";
import { commit, createHistory, undo, type Snapshot } from "./history";
import {
	agentVersion,
	aiVersion,
	checkpointVersion,
	defaultCheckpointName,
	isCurrentVersion,
	listVersions,
	previewFrames,
	restoredSnapshot,
	SESSION_VERSION_LIMIT,
	versionLabel,
	versionSnapshot,
	withVersion,
} from "./versions";
import { emptyCanvas } from "../../shared/project";
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

const SECTION = { id: "s1", name: "Onboarding", color: "blue", x: 0, y: 0, width: 800, height: 900 } as const;

const before: Snapshot = {
	frames: [frame("screens/home.tsx")],
	files: { "screens/home.tsx": "home v1" },
	comments: [],
	name: "App",
	device: "mobile",
	locks: [],
	sections: [],
};

const after: Snapshot = {
	...before,
	frames: [frame("screens/home.tsx", 40), frame("screens/settings.tsx", 500)],
	files: { "screens/home.tsx": "home v2", "screens/settings.tsx": "settings" },
	name: "Renamed",
	locks: [{ file: "screens/settings.tsx", path: [0], name: "div" }],
	sections: [SECTION],
};

describe("versions", () => {
	test("an AI change is labelled by the first line of its prompt", () => {
		expect(versionLabel("  Add a settings screen\nwith dark mode")).toBe("Add a settings screen");
		expect(versionLabel("")).toBe("AI change");
		expect(versionLabel("x".repeat(200))).toHaveLength(80);

		expect(aiVersion("m1", "Settings", after, ["screens/settings.tsx"], new Date(0))).toEqual({
			id: "m1",
			kind: "ai",
			label: "Settings",
			at: "1970-01-01T00:00:00.000Z",
			snapshot: after,
			changed: ["screens/settings.tsx"],
		});
	});

	test("a coding agent's change carries the agent's name", () => {
		const version = agentVersion("Claude Code", "Edited Home", after, ["screens/home.tsx"], new Date(0));

		expect(version).toMatchObject({
			kind: "agent",
			agent: "Claude Code",
			label: "Edited Home",
			at: "1970-01-01T00:00:00.000Z",
			changed: ["screens/home.tsx"],
		});
		expect(listVersions([version], [])[0]).toMatchObject({ source: "session", agent: "Claude Code" });
	});

	test("a checkpoint is named with a timestamp by default", () => {
		expect(defaultCheckpointName(new Date(2026, 9, 10, 15, 4))).toMatch(/^Oct 10, 3:04\sPM$/);
	});

	test("the session keeps the latest versions, and an AI change recorded again replaces itself", () => {
		let versions = withVersion([], aiVersion("m1", "One", before, [], new Date(0)));
		versions = withVersion(versions, aiVersion("m1", "One", after, [], new Date(1)));
		expect(versions).toHaveLength(1);
		expect(versions[0]!.snapshot).toBe(after);

		for (let i = 0; i < SESSION_VERSION_LIMIT + 5; i++)
			versions = withVersion(versions, checkpointVersion(`c${i}`, before, new Date(i)));

		expect(versions).toHaveLength(SESSION_VERSION_LIMIT);
		expect(versions.at(-1)!.label).toBe(`c${SESSION_VERSION_LIMIT + 4}`);
	});

	test("session versions and git checkpoints list newest first", () => {
		const session = [
			aiVersion("m1", "One", before, [], new Date("2026-10-10T10:00:00Z")),
			checkpointVersion("Two", after, new Date("2026-10-10T12:00:00Z")),
		];

		const git = [{ hash: "a".repeat(40), short: "aaaaaaa", name: "Saved", date: "2026-10-10T11:00:00Z" }];
		const listed = listVersions(session, git);

		expect(listed.map((version) => version.label)).toEqual(["Two", "Saved", "One"]);
		expect(listed[1]).toMatchObject({ source: "git", kind: "checkpoint", hash: "a".repeat(40) });
	});

	test("restore brings back the design, keeps the comments and the name, and is one undo step", () => {
		const present = { ...after, comments: [] };
		const history = commit(createHistory(before), present);
		const restored = restoredSnapshot(history.present, before);

		expect(restored.files).toBe(before.files);
		expect(restored.frames).toBe(before.frames);
		expect(restored.locks).toEqual([]);
		expect(restored.sections).toEqual([]);
		expect(restored.name).toBe("Renamed");
		expect(isCurrentVersion(restored, before)).toBe(true);
		expect(isCurrentVersion(present, before)).toBe(false);

		const next = commit(history, restored);
		expect(next.past).toHaveLength(2);
		expect(undo(next).present).toBe(present);
	});

	test("restore brings back the images the version had and keeps the ones added since", () => {
		const restored = restoredSnapshot(
			{ ...after, assets: { "/moodboard/new.png": "b".repeat(32) } },
			{ ...before, assets: { "/moodboard/old.png": "a".repeat(32) } },
		);

		expect(restored.assets).toEqual({ "/moodboard/new.png": "b".repeat(32), "/moodboard/old.png": "a".repeat(32) });
	});

	test("a checkpoint read from git becomes a snapshot with the canvas's theme, or DESIGN.md's", () => {
		const canvas = { ...emptyCanvas("App", "mobile"), frames: [frame("screens/home.tsx")] };
		const snapshot = versionSnapshot(canvas, { "screens/home.tsx": "home" });

		expect(snapshot.frames).toBe(canvas.frames);
		expect(snapshot.theme).toEqual({ light: {}, dark: {} });
		expect(snapshot.sections).toEqual([]);
		const themed = { ...canvas, theme: { light: { primary: "red" }, dark: {} } };
		expect(versionSnapshot(themed, {}).theme).toBe(themed.theme);
	});

	test("previews show the screens without their alternates", () => {
		const snapshot: Snapshot = {
			...before,
			frames: [frame("screens/home.tsx"), frame("screens/home.alt-1.tsx"), frame("screens/gone.tsx")],
			files: { "screens/home.tsx": "", "screens/home.alt-1.tsx": "" },
		};

		expect(previewFrames(snapshot).map((entry) => entry.file)).toEqual(["screens/home.tsx"]);
	});
});
