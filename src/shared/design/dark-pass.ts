import type { Problem } from "../ai/contract";
import { SCHEME } from "../modes";
import type { ModeChoices } from "../types";
import { DESIGN_RULE_LABELS, type DesignRule } from "./findings";
import type { ScreenFindings } from "./polish";

const DARK_RULES: ReadonlySet<DesignRule> = new Set(["contrast", "raw-color"]);

export const MAX_DARK_PROBLEMS = 8;

export const darkChoices = (modes: ModeChoices | undefined): ModeChoices => ({ ...modes, [SCHEME]: "dark" });

export function darkPassProblems(checks: ScreenFindings[]): Problem[] {
	const problems: Problem[] = [];

	for (const { screen, findings } of checks) {
		const seen = new Set<string>();
		let count = 0;

		for (const finding of findings) {
			if (!DARK_RULES.has(finding.rule) || (finding.path ?? screen) !== screen || count >= MAX_DARK_PROBLEMS) continue;
			const message = `${DESIGN_RULE_LABELS[finding.rule]}: ${finding.message}`;
			const key = `${finding.line ?? ""}:${message}`;

			if (seen.has(key)) continue;
			seen.add(key);
			count++;
			problems.push({ path: screen, message, line: finding.line });
		}
	}

	return problems;
}

const screens = (count: number) => (count === 1 ? "1 screen" : `${count} screens`);

export function darkPassNote(checked: number, failing: string[]) {
	if (!checked) return "There are no screens to check in dark mode.";

	if (!failing.length) return `Checked ${screens(checked)} in dark mode with the dark tokens. They all read well.`;

	return `Checked ${screens(checked)} in dark mode with the dark tokens. Fixing ${screens(failing.length)}: ${failing.join(", ")}.`;
}
