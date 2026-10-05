import { describe, expect, test } from "bun:test";
import { extractSuggestion, findDuplicates } from "./duplicates";
import { extractComponent } from "./extract";
import { exportedNames } from "./modules";
import { ANALYTICS, DASHBOARD, TAB_BAR } from "./test-fixtures";

const files = { "screens/dashboard.tsx": DASHBOARD, "screens/analytics.tsx": ANALYTICS, "components/tab-bar.tsx": TAB_BAR, "DESIGN.md": "# Design" };

const screen = (body: string, imports = "") => `${imports}export default function Screen() {\n\treturn (\n\t\t<main>\n${body}\t\t</main>\n\t);\n}\n`;

const feature = (title: string, text: string) => `\t\t\t<div className="flex gap-3 rounded-lg border p-4">
				<Star className="size-5" />
				<div>
					<h3 className="font-medium">${title}</h3>
					<p className="text-sm text-muted-foreground">${text}</p>
				</div>
			</div>
`;

describe("findDuplicates", () => {
	test("finds the repeated stat card across screens, not its inner parts", () => {
		const groups = findDuplicates(files);
		expect(groups).toHaveLength(1);
		const [group] = groups;
		expect(group!.elementCount).toBe(4);
		expect(group!.suggestedName).toBe("Stat card");
		expect(group!.occurrences).toEqual([
			{ path: "screens/analytics.tsx", start: ANALYTICS.indexOf("<Card "), end: ANALYTICS.indexOf("</Card>") + 7 },
			{ path: "screens/dashboard.tsx", start: DASHBOARD.indexOf("<Card "), end: DASHBOARD.indexOf("</Card>") + 7 },
			{ path: "screens/dashboard.tsx", start: DASHBOARD.indexOf("<Card ", DASHBOARD.indexOf("</Card>")), end: DASHBOARD.indexOf("</Card>", DASHBOARD.indexOf("</Card>") + 1) + 7 },
		]);
	});

	test("Make component on any occurrence replaces them all", () => {
		const [group] = findDuplicates(files);
		const last = group!.occurrences[2]!;
		const result = extractComponent({ files, path: last.path, start: last.start, name: group!.suggestedName });
		expect(result.ok && result.replaced).toEqual([
			{ path: "screens/dashboard.tsx", count: 2 },
			{ path: "screens/analytics.tsx", count: 1 },
		]);
		if (!result.ok) return;
		const after = { ...files, ...Object.fromEntries(result.changes.map((c) => [c.path, c.content!])) };
		expect(findDuplicates(after)).toEqual([]);
	});

	test("larger structures win over the parts they contain, and value orders the groups", () => {
		const imports = `import { Star } from "lucide-react";\n\n`;
		const project = {
			"screens/a.tsx": screen(feature("Fast", "Ships in a day and a half") + feature("Safe", "Backed by our guarantee"), imports),
			"screens/b.tsx": screen(feature("Simple", "Nothing to configure at all") + `\t\t\t<ul><li><b>x</b><i>y</i></li><li><b>z</b><i>w</i></li></ul>\n`, imports),
		};
		const groups = findDuplicates(project);
		expect(groups.map((g) => [g.suggestedName, g.occurrences.length, g.elementCount])).toEqual([
			["Feature card", 3, 5],
			["List item", 2, 3],
		]);
		expect(findDuplicates(project, { minElements: 4 }).map((g) => g.suggestedName)).toEqual(["Feature card"]);
		expect(findDuplicates(project, { minOccurrences: 3 }).map((g) => g.suggestedName)).toEqual(["Feature card"]);
	});

	test("alternates are skipped unless asked; project components are not suggested", () => {
		const card = `\t\t\t<section className="p-4"><h2>Plan</h2><p>Free</p></section>\n`;
		const project = { "screens/a.tsx": screen(card), "screens/a.alt-1.tsx": screen(`${card}\t\t\t<hr />\n`) };
		expect(findDuplicates(project)).toEqual([]);
		expect(findDuplicates(project, { includeAlternates: true }).map((g) => g.suggestedName)).toEqual(["Section"]);
		const usage = `\t\t\t<TabBar active={1}><b>x</b><i>y</i></TabBar>\n`;
		const imports = `import { TabBar } from "../components/tab-bar";\n\n`;
		expect(findDuplicates({ "screens/a.tsx": screen(usage + usage, imports), "components/tab-bar.tsx": TAB_BAR })).toEqual([]);
	});

	test("suggestions don't reuse a taken component name", () => {
		const imports = `import { Star } from "lucide-react";\n\n`;
		const project = {
			"screens/a.tsx": screen(feature("Fast", "Ships in a day and a half") + feature("Safe", "Backed by our guarantee"), imports),
			"components/feature-card.tsx": "export function FeatureCard() {\n\treturn null;\n}\n",
		};
		expect(findDuplicates(project)[0]!.suggestedName).toBe("Feature card 2");
	});

	test("broken files are skipped", () => {
		expect(findDuplicates({ ...files, "screens/broken.tsx": "const a = <div>" })).toHaveLength(1);
	});

	test("fast enough to run on every change (30 files of ~300 lines)", () => {
		const big: Record<string, string> = {};
		for (let f = 0; f < 30; f++) {
			let body = "";
			for (let i = 0; i < 24; i++) body += feature(`Title ${f}-${i}`, `Some text ${i}`).replace("gap-3", i % 3 ? "gap-3" : `gap-${f % 4}`);
			big[`screens/s${f}.tsx`] = screen(body, `import { Star } from "lucide-react";\n\n`);
		}
		expect(Object.values(big)[0]!.split("\n").length).toBeGreaterThan(150);
		let start = performance.now();
		const groups = findDuplicates(big);
		const cold = performance.now() - start;
		start = performance.now();
		findDuplicates(big);
		const warm = performance.now() - start;
		expect(groups.length).toBeGreaterThan(0);
		expect(cold).toBeLessThan(400);
		expect(warm).toBeLessThan(50);
	});

	test("a suggestion lists exactly what its Make component replaces", () => {
		const lucide = `import { Star } from "lucide-react";\n\n`;
		// Same shape, but <Star> is defined in the file: it can't be extracted with the others
		const local = `function Star(props: { className?: string }) {\n\treturn <svg {...props} />;\n}\n\n`;
		const project = {
			"screens/a.tsx": screen(feature("Fast", "Ships in a day and a half") + feature("Safe", "Backed by our guarantee"), lucide),
			"screens/b.tsx": screen(feature("Simple", "Nothing to configure at all"), local),
			"screens/a.alt-1.tsx": screen(feature("Quick", "Alternate copy of the card"), lucide),
		};
		const [group, ...rest] = findDuplicates(project);
		expect(rest).toEqual([]);
		expect(group!.occurrences.map((o) => o.path)).toEqual(["screens/a.tsx", "screens/a.tsx"]);
		const result = extractSuggestion(project, group!, group!.suggestedName);
		expect(result.ok && result.replaced).toEqual([{ path: "screens/a.tsx", count: 2 }]);
		// The alternate and the local-Star screen are left alone
		if (result.ok) expect(result.changes.map((c) => c.path).sort()).toEqual(["components/feature-card.tsx", "screens/a.tsx"]);
		// Without the restriction, the alternate would be rewritten too
		const all = extractComponent({ files: project, path: "screens/a.tsx", start: group!.occurrences[0]!.start, name: "Feature card" });
		expect(all.ok && all.replaced.map((r) => r.path)).toEqual(["screens/a.tsx", "screens/a.alt-1.tsx"]);
	});

	test("Make component on a suggestion tries the next occurrence when one can't be extracted", () => {
		const local = `function Star(props: { className?: string }) {\n\treturn <svg {...props} />;\n}\n\n`;
		const lucide = `import { Star } from "lucide-react";\n\n`;
		const project = {
			"screens/a.tsx": screen(feature("Simple", "Nothing to configure at all"), local),
			"screens/b.tsx": screen(feature("Fast", "Ships in a day and a half") + feature("Safe", "Backed by our guarantee"), lucide),
		};
		const b = project["screens/b.tsx"];
		const first = b.indexOf("<div className");
		const second = b.indexOf("<div className", first + 1);
		const group = {
			occurrences: [
				{ path: "screens/a.tsx", start: project["screens/a.tsx"].indexOf("<div className"), end: 0 },
				{ path: "screens/b.tsx", start: first, end: 0 },
				{ path: "screens/b.tsx", start: second, end: 0 },
			],
		};
		const result = extractSuggestion(project, group, "Feature card");
		expect(result.ok && result.replaced).toEqual([{ path: "screens/b.tsx", count: 2 }]);
	});

	test("component export names are read once per content", () => {
		const source = "export function A() {}\nexport const B = 1;\n";
		expect(exportedNames(source)).toBe(exportedNames(source));
		const project: Record<string, string> = {};
		for (let i = 0; i < 300; i++) project[`components/c${i}.tsx`] = `export function C${i}() {\n\treturn <div><p>a</p><b>b</b></div>;\n}\n`;
		const imports = `import { Star } from "lucide-react";\n\n`;
		for (let i = 0; i < 10; i++) project[`screens/s${i}.tsx`] = screen(feature(`T${i}`, "x") + `\t\t\t<ul><li><b>x</b><i>${i}</i></li></ul>\n`, imports);
		findDuplicates(project);
		const start = performance.now();
		expect(findDuplicates(project).length).toBeGreaterThan(0);
		expect(performance.now() - start).toBeLessThan(50);
	});
});
