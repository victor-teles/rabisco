import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arrayOr, objectOr, optionalString, parseJson } from "../../src/bun/json";
import type { Json, JsonObject } from "../../src/shared/json";
import { BRIEFS } from "./briefs";
import { checkLayouts, type LayoutProject } from "./layout";
import { layoutCell, layoutTotalsOf, METRICS, ruleCell } from "./score";

export function layoutProjects(runDir: string, report: Json): LayoutProject[] {
	return arrayOr(objectOr(report).briefs).flatMap((entry) => {
		const { id, ok } = objectOr(entry);
		const brief = BRIEFS.find((candidate) => candidate.id === optionalString(id));
		const dir = brief && join(runDir, `${brief.id}.rabisco`);

		return ok === true && brief && dir && existsSync(dir) ? [{ dir, brief }] : [];
	});
}

export async function rescoreRun(runDir: string) {
	const path = join(runDir, "report.json");

	if (!existsSync(path)) throw new Error(`No report.json in ${runDir}`);
	const report = objectOr(parseJson(readFileSync(path, "utf8")));
	const { run, scores } = await checkLayouts(layoutProjects(runDir, report));

	if ("skipped" in run) return false;

	const briefs = arrayOr(report.briefs).map((entry) => {
		const brief = objectOr(entry);
		const layout = scores.get(optionalString(brief.id) ?? "");

		return layout ? { ...brief, layout } : brief;
	});

	const layoutTotals = layoutTotalsOf([...scores.values()]);
	const totals: JsonObject = { ...objectOr(report.totals), ...layoutTotals };
	writeFileSync(path, `${JSON.stringify({ ...report, layout: run, briefs, totals }, null, "\t")}\n`);

	console.log("");
	console.table([...scores].map(([brief, layout]) => ({ brief, layout: layoutCell(layout), rules: ruleCell(layout) })));

	console.table(
		METRICS.flatMap(({ key, label }) => (key in layoutTotals ? [{ metric: label, total: totals[key] }] : [])),
	);
	console.log(`\nUpdated ${path}`);

	return true;
}
