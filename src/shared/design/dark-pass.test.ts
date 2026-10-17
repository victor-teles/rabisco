import { describe, expect, test } from "bun:test";
import { darkChoices, darkPassNote, darkPassProblems, MAX_DARK_PROBLEMS } from "./dark-pass";
import type { DesignFinding } from "./findings";

const finding = (rule: DesignFinding["rule"], message: string, path?: string): DesignFinding => ({
	rule,
	severity: "error",
	message,
	line: 3,
	path,
});

describe("dark mode pass", () => {
	test("forces the dark scheme and keeps the other choices", () => {
		expect(darkChoices(undefined)).toEqual({ scheme: "dark" });
		expect(darkChoices({ scheme: "light", brand: "acme" })).toEqual({ scheme: "dark", brand: "acme" });
	});

	test("keeps contrast and raw colors on the screen itself, once each", () => {
		const problems = darkPassProblems([
			{
				screen: "screens/a.tsx",
				findings: [
					finding("contrast", "2.1:1"),
					finding("contrast", "2.1:1"),
					finding("raw-color", "bg-white"),
					finding("overlap", "two cards"),
					finding("contrast", "1.5:1", "components/card.tsx"),
				],
			},
			{ screen: "screens/b.tsx", findings: [] },
		]);

		expect(problems).toEqual([
			{ path: "screens/a.tsx", message: "Low contrast: 2.1:1", line: 3 },
			{ path: "screens/a.tsx", message: "Color without a token: bg-white", line: 3 },
		]);
	});

	test("caps the problems per screen", () => {
		const findings = Array.from({ length: 12 }, (_, i) => finding("contrast", `${i}`));

		const problems = darkPassProblems([
			{ screen: "screens/a.tsx", findings },
			{ screen: "screens/b.tsx", findings },
		]);

		expect(problems.filter((p) => p.path === "screens/a.tsx")).toHaveLength(MAX_DARK_PROBLEMS);
		expect(problems.filter((p) => p.path === "screens/b.tsx")).toHaveLength(MAX_DARK_PROBLEMS);
	});

	test("the note says what was checked and what gets fixed", () => {
		expect(darkPassNote(0, [])).toBe("There are no screens to check in dark mode.");
		expect(darkPassNote(3, [])).toContain("Checked 3 screens in dark mode with the dark tokens. They all read well.");
		expect(darkPassNote(1, ["Home"])).toContain(
			"Checked 1 screen in dark mode with the dark tokens. Fixing 1 screen: Home.",
		);
	});
});
