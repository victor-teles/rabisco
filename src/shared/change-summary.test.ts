import { describe, expect, test } from "bun:test";
import { type ChangeSummary, changeSummaryOf, parseChangeSummary } from "./change-summary";

const before = {
	"screens/home.tsx": "home",
	"screens/old.tsx": "old",
	"components/card.tsx": "card",
};

describe("change summary", () => {
	test("sorts real changes by path and skips no-ops", () => {
		const summary = changeSummaryOf(
			before,
			[
				{ path: "screens/home.tsx", content: "home v2" },
				{ path: "screens/new.tsx", content: "new" },
				{ path: "screens/old.tsx", content: null },
				{ path: "components/card.tsx", content: "card" },
				{ path: "screens/missing.tsx", content: null },
			],
			[],
		);

		expect(summary?.problems).toBe(0);
		expect(summary?.files.map(({ path, change }) => ({ path, change }))).toEqual([
			{ path: "screens/home.tsx", change: "modified" },
			{ path: "screens/new.tsx", change: "added" },
			{ path: "screens/old.tsx", change: "deleted" },
		]);
	});

	test("counts added and removed lines and keeps the patch", () => {
		const summary = changeSummaryOf(
			{ "screens/home.tsx": "a\nb\nc\n" },
			[{ path: "screens/home.tsx", content: "a\nB\nc\nd\n" }],
			[],
		);

		const file = summary?.files[0];

		expect(file).toMatchObject({ additions: 2, deletions: 1 });
		expect(file?.patch).toContain("-b\n+B\n");
	});

	test("nothing changed and no problems: no summary", () => {
		expect(changeSummaryOf(before, [], [])).toBeNull();
		expect(changeSummaryOf(before, [{ path: "screens/home.tsx", content: "home" }], [])).toBeNull();
	});

	test("problems alone still make a summary", () => {
		expect(changeSummaryOf(before, [], [{ path: "screens/bad.tsx", message: "x" }])).toEqual({
			files: [],
			problems: 1,
		});
	});

	test("parses a saved summary and drops malformed ones", () => {
		const saved: ChangeSummary = {
			files: [{ path: "screens/home.tsx", change: "added", additions: 3, deletions: 0, patch: "+a" }],
			problems: 1,
		};

		expect(parseChangeSummary(saved)).toEqual(saved);
		expect(parseChangeSummary({ files: [{ path: "a", change: "added" }], problems: 0 })).toEqual({
			files: [{ path: "a", change: "added", additions: 0, deletions: 0 }],
			problems: 0,
		});
		expect(parseChangeSummary(undefined)).toBeUndefined();
		expect(parseChangeSummary({ files: [], problems: "1" })).toBeUndefined();
		expect(parseChangeSummary({ files: [{ path: "a", change: "renamed" }], problems: 0 })).toBeUndefined();
		expect(parseChangeSummary({ files: "nope", problems: 0 })).toBeUndefined();
	});

	test("keeps the design notes and drops a malformed note on its own", () => {
		const saved: ChangeSummary = {
			files: [{ path: "screens/home.tsx", change: "added", additions: 3, deletions: 0 }],
			problems: 0,
			design: [
				{
					rule: "text-clipped",
					severity: "error",
					message: "<p> is cut off",
					screen: "screens/home.tsx",
					path: "screens/home.tsx",
					start: 12,
					line: 2,
					version: "abc",
				},
			],
		};

		expect(parseChangeSummary(saved)).toEqual(saved);

		const mixed = { ...saved, design: [...(saved.design ?? []), { rule: "sparkle", message: "x" }, 4] };

		expect(parseChangeSummary(mixed)).toEqual(saved);
		expect(parseChangeSummary({ ...saved, design: [] })).toEqual({ files: saved.files, problems: 0 });
	});
});
