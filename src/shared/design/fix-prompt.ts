import { DESIGN_RULE_LABELS, type DesignFinding } from "./findings";

export type NamedFindings = { name: string; findings: DesignFinding[] };

const placeOf = (finding: DesignFinding) =>
	finding.path ? ` (${finding.path}${finding.line ? `:${finding.line}` : ""})` : "";

/** One prompt that asks to fix every finding, grouped by screen; empty when there is nothing to fix */
export function fixPrompt(intro: string, screens: NamedFindings[]) {
	const sections = screens.flatMap(({ name, findings }) =>
		findings.length
			? [
					[
						name,
						...findings.map(
							(finding) => `- ${DESIGN_RULE_LABELS[finding.rule]}: ${finding.message}${placeOf(finding)}`,
						),
					].join("\n"),
				]
			: [],
	);

	return sections.length ? [intro, ...sections].join("\n\n") : "";
}
