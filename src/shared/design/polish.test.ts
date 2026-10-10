import { describe, expect, test } from "bun:test";
import type { DesignNote } from "../change-summary";
import { hashString } from "../jsx/hash";
import type { ProjectFiles } from "../types";
import type { DesignFinding } from "./findings";
import {
	designNotesOf,
	isFreshNote,
	MAX_DESIGN_NOTES,
	MAX_POLISH_PROBLEMS,
	mergeChanges,
	noteProblem,
	noteSelection,
	notesByFile,
	POLISH_PROMPT,
	POLISHED_TASKS,
	polishLabel,
	polishModeOf,
	polishProblems,
	polishRequest,
	polishWrites,
	reviewNote,
	reviewRaster,
	reviewRequest,
	screenshotOf,
} from "./polish";

const clipped: DesignFinding = {
	rule: "text-clipped",
	severity: "error",
	message: "<p> “Welcome back” is cut off",
	path: "screens/home.tsx",
	start: 120,
	line: 8,
};

const lowContrast: DesignFinding = {
	rule: "contrast",
	severity: "error",
	message: "<span> “Pro” has a contrast of 2.1:1, under 3:1",
	path: "components/badge.tsx",
	start: 40,
	line: 3,
};

const rawColor: DesignFinding = {
	rule: "raw-color",
	severity: "warning",
	message: "bg-emerald-500 hard-codes a fill.",
	path: "screens/home.tsx",
	start: 300,
	line: 14,
};

describe("polish problems", () => {
	test("only errors become problems, with the rule, path and line", () => {
		const problems = polishProblems([{ screen: "screens/home.tsx", findings: [clipped, rawColor, lowContrast] }]);

		expect(problems).toEqual([
			{ path: "screens/home.tsx", message: "Clipped text: <p> “Welcome back” is cut off", line: 8 },
			{
				path: "components/badge.tsx",
				message: "Low contrast: <span> “Pro” has a contrast of 2.1:1, under 3:1",
				line: 3,
			},
		]);
	});

	test("a component reported by two screens is one problem", () => {
		const problems = polishProblems([
			{ screen: "screens/home.tsx", findings: [lowContrast] },
			{ screen: "screens/settings.tsx", findings: [lowContrast] },
		]);

		expect(problems).toHaveLength(1);
	});

	test("a finding without a path points at its screen", () => {
		const { path: _path, ...overflow } = { ...clipped, rule: "frame-overflow" as const };
		const [problem] = polishProblems([{ screen: "screens/wide.tsx", findings: [overflow] }]);

		expect(problem?.path).toBe("screens/wide.tsx");
	});

	test("caps the problems of one polish", () => {
		const findings = Array.from({ length: 12 }, (_, i) => ({ ...clipped, start: i * 10, line: i + 1 }));

		expect(polishProblems([{ screen: "screens/home.tsx", findings }])).toHaveLength(MAX_POLISH_PROBLEMS);
	});

	test("nothing to polish without errors", () => {
		expect(polishProblems([{ screen: "screens/home.tsx", findings: [rawColor] }])).toEqual([]);
		expect(polishProblems([])).toEqual([]);
	});
});

describe("polish request", () => {
	test("targets each file once and says the problems are visual", () => {
		const problems = polishProblems([{ screen: "screens/home.tsx", findings: [clipped, lowContrast, clipped] }]);
		const request = polishRequest(problems);

		expect(request.targets).toEqual(["screens/home.tsx", "components/badge.tsx"]);
		expect(request.problems).toBe(problems);
		expect(request.prompt).toBe(POLISH_PROMPT);
		expect(request.prompt).toContain("after the screens rendered");
		expect(request.prompt).toContain("smallest change");
	});

	test("checks creates, edits and variations only", () => {
		expect([...POLISHED_TASKS].sort()).toEqual(["create", "edit", "vary"]);
	});

	test("labels the step", () => {
		expect(polishLabel(1)).toBe("Polishing 1 problem");
		expect(polishLabel(2)).toBe("Polishing 2 problems");
	});
});

describe("design notes", () => {
	const files = {
		"screens/home.tsx": "export default function Home() {}",
		"components/badge.tsx": "export function Badge() {}",
	};

	test("errors first, each with its screen and the version of its file", () => {
		const notes = designNotesOf([{ screen: "screens/home.tsx", findings: [rawColor, clipped, lowContrast] }], files);

		expect(notes.map((note) => [note.rule, note.path])).toEqual([
			["contrast", "components/badge.tsx"],
			["text-clipped", "screens/home.tsx"],
			["raw-color", "screens/home.tsx"],
		]);
		expect(notes[0]?.screen).toBe("screens/home.tsx");
		expect(notes[0]?.version).toBe(hashString(files["components/badge.tsx"]));
	});

	test("keeps one note per element and rule, up to the cap", () => {
		const findings = Array.from({ length: 30 }, (_, i) => ({ ...rawColor, start: i, line: i + 1 }));

		const notes = designNotesOf(
			[
				{ screen: "screens/home.tsx", findings: [clipped, ...findings] },
				{ screen: "screens/home.tsx", findings: [clipped] },
			],
			files,
		);

		expect(notes).toHaveLength(MAX_DESIGN_NOTES);
		expect(notes.filter((note) => note.rule === "text-clipped")).toHaveLength(1);
	});

	test("group under their file", () => {
		const notes = designNotesOf([{ screen: "screens/home.tsx", findings: [clipped, lowContrast, rawColor] }], files);

		expect(notesByFile(notes).map((group) => [group.path, group.notes.length])).toEqual([
			["components/badge.tsx", 1],
			["screens/home.tsx", 2],
		]);
	});

	test("a note goes stale once its file changes", () => {
		const [note] = designNotesOf([{ screen: "screens/home.tsx", findings: [clipped] }], files);

		expect(note && isFreshNote(note, files)).toBe(true);
		expect(note && isFreshNote(note, { ...files, "screens/home.tsx": "changed" })).toBe(false);
		expect(note && isFreshNote(note, {})).toBe(false);
	});
});

describe("note actions", () => {
	const files: ProjectFiles = { "screens/home.tsx": "home source", "components/badge.tsx": "badge source" };

	const note = (finding: DesignFinding, path: string): DesignNote => ({
		...finding,
		screen: "screens/home.tsx",
		path,
		version: hashString(files[path] ?? ""),
	});

	test("Fix repairs the note, with its line only while it is fresh", () => {
		const fix = note(clipped, "screens/home.tsx");

		expect(noteProblem(fix, true)).toEqual({
			path: "screens/home.tsx",
			message: "Clipped text: <p> “Welcome back” is cut off",
			line: 8,
		});
		expect(noteProblem(fix, false).line).toBeUndefined();
	});

	test("a click selects the element in the screen's own file", () => {
		expect(noteSelection(note(clipped, "screens/home.tsx"), files)).toEqual({
			screen: "screens/home.tsx",
			element: { file: "screens/home.tsx", start: 120 },
		});
	});

	test("a note in a component, or a stale one, selects the screen", () => {
		expect(noteSelection(note(lowContrast, "components/badge.tsx"), files)?.element).toBeNull();
		expect(
			noteSelection(note(clipped, "screens/home.tsx"), { ...files, "screens/home.tsx": "edited" })?.element,
		).toBeNull();
		expect(noteSelection(note(clipped, "screens/home.tsx"), {})).toBeNull();
	});
});

describe("merged changes", () => {
	test("the polish's write wins, one change per path", () => {
		const merged = mergeChanges(
			[
				{ path: "screens/home.tsx", content: "v1" },
				{ path: "components/badge.tsx", content: "badge" },
			],
			[{ path: "screens/home.tsx", content: "v2" }],
		);

		expect(merged).toEqual([
			{ path: "screens/home.tsx", content: "v2" },
			{ path: "components/badge.tsx", content: "badge" },
		]);
	});
});

describe("polish writes", () => {
	test("keeps rewrites of existing files and drops new files, deletes and no-ops", () => {
		const files = { "screens/home.tsx": "v1", "components/badge.tsx": "badge" };

		const writes = polishWrites(
			[
				{ path: "screens/home.tsx", content: "v2" },
				{ path: "components/badge.tsx", content: "badge" },
				{ path: "screens/home-2.tsx", content: "new" },
				{ path: "components/badge.tsx", content: null },
			],
			files,
			["screens/home.tsx", "components/badge.tsx", "screens/home-2.tsx"],
		);

		expect(writes).toEqual([{ path: "screens/home.tsx", content: "v2" }]);
	});

	test("only its targets are writable", () => {
		const files = { "screens/home.tsx": "v1", "screens/settings.tsx": "s1" };

		const writes = polishWrites(
			[
				{ path: "screens/home.tsx", content: "v2" },
				{ path: "screens/settings.tsx", content: "s2" },
			],
			files,
			["screens/home.tsx"],
		);

		expect(writes).toEqual([{ path: "screens/home.tsx", content: "v2" }]);
	});
});

describe("visual review", () => {
	const shot = "data:image/jpeg;base64,/9j/AAAA";

	test("the review needs the polish; both are on by default", () => {
		expect(polishModeOf(true, true)).toBe("review");
		expect(polishModeOf(true, false)).toBe("polish");
		expect(polishModeOf(false, true)).toBe("off");
		expect(polishModeOf(false, false)).toBe("off");
	});

	test("screenshots are JPEGs at most 1280 wide, cut at twice the frame's height", () => {
		expect(reviewRaster(390, 844)).toEqual({ type: "image/jpeg", scale: 1, quality: 0.8, maxHeight: 1688 });
		expect(reviewRaster(2560, 1440).scale).toBe(0.5);
	});

	test("a screenshot is an attachment named after its screen", () => {
		expect(screenshotOf("screens/home.tsx", shot)).toEqual({
			name: "screens/home.tsx.jpg",
			mediaType: "image/jpeg",
			data: "/9j/AAAA",
		});
		expect(screenshotOf("screens/home.tsx", "not a data url")).toBeNull();
	});

	test("attaches each screen's screenshot and runs even with no errors", () => {
		const request = reviewRequest("A meal planner home screen", [
			{ screen: "screens/home.tsx", findings: [rawColor], image: shot },
			{ screen: "screens/plan.tsx", findings: [], image: shot },
		]);

		expect(request.problems).toEqual([]);
		expect(request.targets).toEqual(["screens/home.tsx", "screens/plan.tsx"]);
		expect(request.review?.attachments.map((a) => a.name)).toEqual(["screens/home.tsx.jpg", "screens/plan.tsx.jpg"]);

		const prompt = request.review?.prompt ?? "";

		expect(prompt).toContain("screenshots of the screens as they render now");
		expect(prompt).toContain("if nothing needs fixing, write no files");
		expect(prompt).toContain("screens/home.tsx:14: Color without a token: bg-emerald-500 hard-codes a fill.");
		expect(prompt).toContain("A meal planner home screen");
		expect(prompt).not.toContain(POLISH_PROMPT);
	});

	test("errors are listed first, and their files are writable too", () => {
		const request = reviewRequest("Edit the badge", [
			{ screen: "screens/home.tsx", findings: [lowContrast, clipped], image: shot },
		]);

		expect(request.problems).toHaveLength(2);
		expect(request.targets).toEqual(["screens/home.tsx", "components/badge.tsx"]);
		expect(request.review?.prompt.startsWith(POLISH_PROMPT)).toBe(true);
		expect(request.prompt).toBe(POLISH_PROMPT);
	});

	test("without screenshots it is the plain polish", () => {
		const request = reviewRequest("x", [{ screen: "screens/home.tsx", findings: [clipped] }]);

		expect(request.review).toBeUndefined();
		expect(request).toEqual(polishRequest(polishProblems([{ screen: "screens/home.tsx", findings: [clipped] }])));
	});

	test("the note says what the review changed", () => {
		const writes = [{ path: "screens/home.tsx", content: "v2" }];

		expect(reviewNote("Tightened spacing in Home.", writes)).toBe("Review: tightened spacing in Home.");
		expect(reviewNote("", writes)).toBe("Review: changed Home.");
		expect(reviewNote("Nothing to fix.", [])).toBe("Review: nothing to fix.");
	});
});
