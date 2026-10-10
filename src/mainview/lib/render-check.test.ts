import { describe, expect, test } from "bun:test";
import { renderCheckOf, renderRepairOf } from "./render-check";

const files = {
	"components/stat-card.tsx": `export function StatCard({ title }: { title: string }) { return <div>{title}</div>; }\n`,
	"components/stat-grid.tsx": `import { StatCard } from "./stat-card";\nexport function StatGrid() { return <StatCard title="a" />; }\n`,
	"screens/home.tsx": `import { StatCard } from "../components/stat-card";\nexport default function Home() { return <StatCard label="x" />; }\n`,
	"screens/stats.tsx": `import { StatGrid } from "../components/stat-grid";\nexport default function Stats() { return <StatGrid />; }\n`,
	"screens/about.tsx": `export default function About() { return <p />; }\n`,
};

describe("renderCheckOf", () => {
	test("watches written screens", () => {
		const check = renderCheckOf(files, [{ path: "screens/about.tsx", content: files["screens/about.tsx"]! }]);
		expect(check.screens).toEqual(["screens/about.tsx"]);
		expect(check.via.size).toBe(0);
	});
	test("a component-only write watches every screen that uses it, through other components too", () => {
		const check = renderCheckOf(files, [
			{ path: "components/stat-card.tsx", content: files["components/stat-card.tsx"]! },
		]);

		expect(check.screens).toEqual(["screens/home.tsx", "screens/stats.tsx"]);
		expect(check.via.get("screens/stats.tsx")).toEqual(["components/stat-card.tsx"]);
	});
	test("a screen it also wrote is checked as written, and deletes are ignored", () => {
		const { "screens/about.tsx": _, ...rest } = files;

		const check = renderCheckOf(rest, [
			{ path: "components/stat-card.tsx", content: files["components/stat-card.tsx"]! },
			{ path: "screens/home.tsx", content: files["screens/home.tsx"]! },
			{ path: "screens/about.tsx", content: null },
		]);

		expect(check.screens).toEqual(["screens/home.tsx", "screens/stats.tsx"]);
		expect([...check.via.keys()]).toEqual(["screens/stats.tsx"]);
	});
});

describe("renderRepairOf", () => {
	test("targets the failing file, and the screen and component when a component broke it", () => {
		const via = new Map([["screens/home.tsx", ["components/stat-card.tsx"]]]);

		const repair = renderRepairOf(
			[
				{
					entry: "screens/home.tsx",
					problem: { path: "components/stat-card.tsx", message: "title is undefined", line: 1 },
				},
				{ entry: "screens/about.tsx", problem: { path: "screens/about.tsx", message: "x is not defined" } },
			],
			via,
		);

		expect(repair.targets).toEqual(["components/stat-card.tsx", "screens/home.tsx", "screens/about.tsx"]);
		expect(repair.problems[0]!.message).toBe(
			"title is undefined (screens/home.tsx uses components/stat-card.tsx, which just changed)",
		);
		expect(repair.problems[1]).toEqual({ path: "screens/about.tsx", message: "x is not defined" });
	});
});
