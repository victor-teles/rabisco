import { describe, expect, test } from "bun:test";
import { generateMockScreens } from "../mock-generator";
import { cachedComponentApi, componentSignatures, componentUsages, projectComponents, screensUsing } from "./usages";

const files = {
	"components/stat-card.tsx": `export function StatCard({ label }: { label: string }) { return <div>{label}</div>; }\n`,
	"components/tab-bar.tsx": `import { cn } from "@/lib/utils";\nexport function TabBar({ active = 0 }: { active?: number }) { return <nav className={cn("flex")} />; }\n`,
	"components/stat-grid.tsx": `import { StatCard } from "./stat-card";\nexport function StatGrid() { return <StatCard label="a" />; }\n`,
	"components/unused.tsx": `export function Unused() { return null; }\n`,
	"screens/home.tsx": `import { Button } from "@/components/ui/button";
import {
	StatCard,
	type StatCardProps,
} from "../components/stat-card";
import { TabBar as Tabs } from "../components/tab-bar.tsx";
export default function Home() { return <div><StatCard label="x" /><Tabs /><Button /></div>; }
`,
	"screens/stats.tsx": `import type { Foo } from "../components/unused";
import * as Grid from "../components/stat-grid";
import "../components/tab-bar";
export default function Stats() { return <Grid.StatGrid />; }
`,
	"screens/broken.tsx": `import { Missing } from "../components/missing";\nimport { X } from "./elsewhere";\n`,
	"DESIGN.md": `import { StatCard } from "./components/stat-card"`,
};

describe("componentUsages", () => {
	test("maps every component file to the files that import it", () => {
		expect(Object.fromEntries(componentUsages(files))).toEqual({
			"components/stat-card.tsx": [
				{ path: "components/stat-grid.tsx", names: ["StatCard"] },
				{ path: "screens/home.tsx", names: ["StatCard"] },
			],
			"components/stat-grid.tsx": [{ path: "screens/stats.tsx", names: ["*"] }],
			"components/tab-bar.tsx": [
				{ path: "screens/home.tsx", names: ["TabBar"] },
				{ path: "screens/stats.tsx", names: [] },
			],
			"components/unused.tsx": [],
		});
	});

	test("default imports and side-effect lines don't swallow the next import", () => {
		const usages = componentUsages({
			"components/a.tsx": "export function A() { return null; }",
			"screens/s.tsx": `import "./x";\nimport A, { A as B } from "../components/a";\n`,
		});

		expect(usages.get("components/a.tsx")).toEqual([{ path: "screens/s.tsx", names: ["default", "A"] }]);
	});
});

describe("projectComponents", () => {
	test("components with their API and users, sorted by path", () => {
		const list = projectComponents(files);
		expect(list.map((c) => c.path)).toEqual([
			"components/stat-card.tsx",
			"components/stat-grid.tsx",
			"components/tab-bar.tsx",
			"components/unused.tsx",
		]);
		expect(list[0]!.exports.map((e) => e.name)).toEqual(["StatCard"]);
		expect(list[0]!.usedBy).toEqual(["components/stat-grid.tsx", "screens/home.tsx"]);
		expect(list[3]!.usedBy).toEqual([]);
	});

	test("memoized by content", () => {
		const source = files["components/stat-card.tsx"];
		expect(cachedComponentApi("components/stat-card.tsx", source)).toBe(
			cachedComponentApi("components/stat-card.tsx", source),
		);
	});

	test("catalog signatures for a generated project", () => {
		const generated = Object.fromEntries(
			generateMockScreens({ prompt: "A habit tracker", device: "mobile" }).changes.map((c) => [c.path, c.content!]),
		);

		const catalog = componentSignatures(generated);
		const tabBar = catalog.find((c) => c.path === "components/tab-bar.tsx")!;
		expect(tabBar.signature).toEqual(["TabBar({ active?: number = 0 })"]);
		expect(tabBar.usedBy!.length).toBeGreaterThan(0);
		expect(componentSignatures({ "components/lonely.tsx": "export function Lonely() { return null; }" })).toEqual([
			{ path: "components/lonely.tsx", signature: ["Lonely()"] },
		]);
	});

	test("is fast enough to run on every change", () => {
		const big: Record<string, string> = {};

		for (let i = 0; i < 40; i++)
			big[`components/c-${i}.tsx`] =
				`${files["components/stat-grid.tsx"]}\nexport function C${i}({ a = ${i} }: { a?: number }) { return <div>{a}</div>; }\n`;

		for (let i = 0; i < 40; i++) big[`screens/s-${i}.tsx`] = files["screens/home.tsx"].repeat(5);
		const start = performance.now();
		projectComponents(big);
		projectComponents(big);
		expect(performance.now() - start).toBeLessThan(500);
	});
});

describe("screensUsing", () => {
	test("finds screens that use a component directly or through other components", () => {
		expect(screensUsing(files, ["components/stat-card.tsx"])).toEqual(
			new Map([
				["screens/home.tsx", ["components/stat-card.tsx"]],
				["screens/stats.tsx", ["components/stat-card.tsx"]],
			]),
		);
		expect(screensUsing(files, ["components/stat-grid.tsx", "components/tab-bar.tsx"])).toEqual(
			new Map([
				["screens/home.tsx", ["components/tab-bar.tsx"]],
				["screens/stats.tsx", ["components/stat-grid.tsx", "components/tab-bar.tsx"]],
			]),
		);
	});
	test("ignores type-only imports, unknown paths and import cycles", () => {
		expect(screensUsing(files, ["components/unused.tsx", "components/missing.tsx", "screens/home.tsx"]).size).toBe(0);

		const cyclic = {
			"components/a.tsx": `import { B } from "./b";\nexport function A() { return <B />; }\n`,
			"components/b.tsx": `import { A } from "./a";\nexport function B() { return <A />; }\n`,
			"screens/s.tsx": `import { B } from "../components/b";\nexport default function S() { return <B />; }\n`,
		};

		expect(screensUsing(cyclic, ["components/a.tsx"])).toEqual(new Map([["screens/s.tsx", ["components/a.tsx"]]]));
	});
});
