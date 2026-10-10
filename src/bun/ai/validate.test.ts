import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { FILE_RULES } from "../../shared/ai/contract";
import { generateMockScreens } from "../../shared/mock-generator";
import { UI_MODULES } from "./prompt";
import { validateFiles } from "./validate";

const SCREEN = `import { Button } from "@/components/ui/button";
import { StatCard } from "../components/stat-card";

export default function Welcome() {
	return <div><StatCard label="a" value="b" /><Button>Go</Button></div>;
}
`;

const COMPONENT = `import { cn } from "@/lib/utils";

export function StatCard({ label, value }: { label: string; value: string }) {
	return <div className={cn("p-4")}>{label}{value}</div>;
}
`;

const project = { "components/stat-card.tsx": COMPONENT };

const one = (path: string, content: string, files: Record<string, string> = project, deleted?: string[]) =>
	validateFiles([{ path, content }], files, deleted);

describe("validateFiles", () => {
	test("mock generator output is valid", () => {
		for (const device of ["mobile", "desktop"] as const) {
			const result = generateMockScreens({ prompt: "A habit tracker", device });
			const files = result.changes.map((c) => ({ path: c.path, content: c.content! }));
			expect(validateFiles(files, {})).toEqual([]);
		}
	});

	test("ui module list matches the frame runtime", () => {
		const source = readFileSync(join(import.meta.dir, "../../mainview/runtime/externals.ts"), "utf-8");
		const runtime = [...source.matchAll(/^\s*"@\/components\/ui\/((?:uai\/)?[a-z0-9-]+)":/gm)].map((m) => m[1]).sort();
		expect(Object.keys(UI_MODULES).sort()).toEqual(runtime);
	});

	describe("path", () => {
		test("accepts screens and components", () => {
			expect(one("screens/welcome.tsx", SCREEN)).toEqual([]);
			expect(one("components/stat-card.tsx", COMPONENT, {})).toEqual([]);
		});

		for (const path of [
			"screens/Welcome.tsx",
			"src/welcome.tsx",
			"screens/a/b.tsx",
			"../welcome.tsx",
			"screens/welcome.ts",
			"PRODUCT.md",
			"screens/-a.tsx",
		]) {
			test(`rejects ${path}`, () => {
				expect(one(path, SCREEN).some((p) => p.path === path && /screens\/<kebab-name>/.test(p.message))).toBe(true);
			});
		}

		test("rejects alternates with a hint", () => {
			const [problem] = one("screens/welcome.alt-1.tsx", SCREEN);
			expect(problem!.message).toContain("screens/welcome.tsx");
		});
		test("rejects invalid deletes", () => {
			expect(validateFiles([], {}, ["rabisco.json"])).toHaveLength(1);
			expect(validateFiles([], { "screens/a.tsx": "" }, ["screens/a.tsx"])).toEqual([]);
		});
	});

	test("max length", () => {
		const big = SCREEN + `// ${"x".repeat(FILE_RULES.maxFileLength)}\n`;
		const problems = one("screens/welcome.tsx", big);
		expect(problems).toHaveLength(1);
		expect(problems[0]!.message).toContain(String(FILE_RULES.maxFileLength));
	});

	test("compile errors carry the line", () => {
		const problems = one("screens/welcome.tsx", `export default function A() {\n\treturn (\n\t\t<div>\n\t);\n}\n`);
		expect(problems).toHaveLength(1);
		expect(problems[0]!.message).toStartWith("Syntax error:");
		expect(problems[0]!.line).toBe(4);
	});

	describe("imports", () => {
		const screen = (imports: string) => `${imports}\nexport default function A() { return <div /> }\n`;
		test("allows react, lucide, utils and existing ui modules", () => {
			const src = screen(
				`import { useState } from "react";\nimport { Bell } from "lucide-react";\nimport { cn } from "@/lib/utils";\nimport { Dialog } from "@/components/ui/dialog";\nvoid [useState, Bell, cn, Dialog];`,
			);

			expect(one("screens/a.tsx", src)).toEqual([]);
		});
		test("rejects unknown packages with the line", () => {
			const problems = one(
				"screens/a.tsx",
				screen(`import React from "react";\nimport { motion } from "framer-motion";\nvoid [React, motion];`),
			);

			expect(problems).toEqual([{ path: "screens/a.tsx", message: expect.stringContaining("framer-motion"), line: 2 }]);
		});
		test("rejects ui modules the runtime doesn't have", () => {
			const problems = one(
				"screens/a.tsx",
				screen(`import { Calendar } from "@/components/ui/calendar";\nvoid Calendar;`),
			);

			expect(problems).toHaveLength(1);
			expect(problems[0]!.message).toContain("not available");
		});
		test("allows the uai blocks screens can use, not the editor's", () => {
			const block = screen(`import { MetricCard } from "@/components/ui/uai/metric-card";\nvoid MetricCard;`);
			expect(one("screens/a.tsx", block)).toEqual([]);

			const editor = one(
				"screens/a.tsx",
				screen(`import { ToolCall } from "@/components/ui/uai/tool-call";\nvoid ToolCall;`),
			);

			expect(editor).toHaveLength(1);
			expect(editor[0]!.message).toContain("not available");
		});
		test("rejects unused imports of unknown modules too", () => {
			expect(one("screens/a.tsx", screen(`import { x } from "lodash";`))).toHaveLength(1);
		});
		test("ignores type-only imports", () => {
			expect(
				one("screens/a.tsx", screen(`import type { Foo } from "some-types";\nlet f: Foo | null = null; void f;`)),
			).toEqual([]);
		});
		test("screens import components via ../components", () => {
			expect(
				one("screens/a.tsx", screen(`import { StatCard } from "../components/stat-card";\nvoid StatCard;`)),
			).toEqual([]);
			expect(one("screens/a.tsx", screen(`import { StatCard } from "./stat-card";\nvoid StatCard;`))).toHaveLength(1);
			expect(
				one("screens/a.tsx", screen(`import B from "./b";\nvoid B;`), { ...project, "screens/b.tsx": "" }),
			).toHaveLength(1);
		});
		test("components import each other via ./x (or ../components/x)", () => {
			const src = (spec: string) =>
				`import { StatCard } from "${spec}";\nexport function Row() { return <StatCard label="" value="" /> }\n`;

			expect(one("components/row.tsx", src("./stat-card"))).toEqual([]);
			expect(one("components/row.tsx", src("../components/stat-card"))).toEqual([]);
			expect(one("components/row.tsx", src("./missing"))).toHaveLength(1);
		});
		test("a missing component is fine when co-written, not when deleted", () => {
			const screenFile = { path: "screens/a.tsx", content: SCREEN };
			expect(validateFiles([screenFile], {})).toHaveLength(1);
			expect(validateFiles([screenFile, { path: "components/stat-card.tsx", content: COMPONENT }], {})).toEqual([]);
			const problems = validateFiles([screenFile], project, ["components/stat-card.tsx"]);
			expect(problems).toEqual([{ path: "screens/a.tsx", message: expect.stringContaining("doesn't exist"), line: 2 }]);
		});
	});

	describe("exports", () => {
		test("screens accept every default export form", () => {
			for (const src of [
				`export default function A() { return <div /> }`,
				`function A() { return <div /> }\nexport default A;`,
				`const A = () => <div />;\nexport { A as default };`,
				`export default () => <div />;`,
			]) {
				expect(one("screens/a.tsx", src)).toEqual([]);
			}
		});
		test("screens need a component as default export", () => {
			expect(one("screens/a.tsx", `export function A() { return <div /> }`)[0]!.message).toContain("default-export");
			expect(one("screens/a.tsx", `export default "hello";`)[0]!.message).toContain("must be a React component");
		});
		test("components need a named export and no default", () => {
			expect(one("components/a.tsx", `export const A = () => <div />;\nexport type P = {};`)).toEqual([]);
			expect(one("components/a.tsx", `export default function A() { return <div /> }`).map((p) => p.message)).toEqual([
				expect.stringContaining("named exports only"),
				expect.stringContaining("at least one named export"),
			]);
			expect(one("components/a.tsx", `export function A() { return <div /> }\nexport { A as default };`)).toEqual([
				{ path: "components/a.tsx", message: expect.stringContaining("named exports only"), line: 2 },
			]);
			expect(one("components/a.tsx", `export type P = {};\nconst A = 1;`)[0]!.message).toContain(
				"at least one named export",
			);
		});
	});

	describe("duplicate components", () => {
		const copy = `export function StatCard({ label }: { label: string }) {\n\treturn <p>{label}</p>;\n}\n`;

		test("a new component file can't export a component another file exports", () => {
			const problems = one("components/metric-card.tsx", copy);
			expect(problems).toEqual([
				{
					path: "components/metric-card.tsx",
					line: 1,
					message:
						'StatCard is already exported by components/stat-card.tsx. Import it from "../components/stat-card" instead of re-creating it; if it needs to change, edit components/stat-card.tsx (add an optional prop or variant) and update the files that use it.',
				},
			]);
		});

		test("rewriting the same file, moving it, or new names are fine", () => {
			expect(one("components/stat-card.tsx", copy)).toEqual([]);
			expect(
				validateFiles([{ path: "components/metric-card.tsx", content: copy }], project, ["components/stat-card.tsx"]),
			).toEqual([]);
			expect(one("components/metric-card.tsx", copy.replace("StatCard", "MetricCard"))).toEqual([]);

			const moved = [
				{ path: "components/stat-card.tsx", content: `export function Other() { return null; }\n` },
				{ path: "components/metric-card.tsx", content: copy },
			];

			expect(validateFiles(moved, project)).toEqual([]);
		});

		test("an edit that adds an export another file has is flagged; names it had before are not", () => {
			const files = { ...project, "components/legacy.tsx": copy };
			expect(one("components/legacy.tsx", `${copy}export function Extra() { return null; }\n`, files)).toEqual([]);

			const edited = one("components/tab-bar.tsx", `export function TabBar() { return null; }\n${copy}`, {
				...project,
				"components/tab-bar.tsx": "export function TabBar() { return null; }\n",
			});

			expect(edited.map((p) => [p.path, p.line])).toEqual([["components/tab-bar.tsx", 2]]);
		});

		test("of two new files with the same component, the later one is flagged", () => {
			const problems = validateFiles(
				[
					{ path: "components/a.tsx", content: copy.replace("StatCard", "Tile") },
					{ path: "components/b.tsx", content: copy.replace("StatCard", "Tile") },
				],
				{},
			);

			expect(problems.map((p) => p.path)).toEqual(["components/b.tsx"]);
			expect(problems[0]!.message).toContain('Import it from "../components/a"');
		});

		test("mock generator output against itself is clean", () => {
			const files = generateMockScreens({ prompt: "A habit tracker", device: "desktop" }).changes.map((c) => ({
				path: c.path,
				content: c.content!,
			}));

			expect(validateFiles(files, Object.fromEntries(files.map((f) => [f.path, f.content])))).toEqual([]);
		});
	});

	describe("context task", () => {
		const opts = { contextTarget: "DESIGN.md" };
		test("accepts its Markdown target without compiling it", () => {
			expect(validateFiles([{ path: "DESIGN.md", content: "# Design\n\n<div> not tsx\n" }], {}, [], opts)).toEqual([]);
		});
		test("rejects an empty or oversized target", () => {
			expect(validateFiles([{ path: "DESIGN.md", content: " \n" }], {}, [], opts)[0]!.message).toContain("empty");
			expect(
				validateFiles([{ path: "DESIGN.md", content: "x".repeat(FILE_RULES.maxFileLength + 1) }], {}, [], opts)[0]!
					.message,
			).toContain(String(FILE_RULES.maxFileLength));
		});
		test("rejects every other write and every delete", () => {
			const problems = validateFiles(
				[
					{ path: "PRODUCT.md", content: "# Product\n\nx" },
					{ path: "screens/welcome.tsx", content: SCREEN },
				],
				project,
				["components/stat-card.tsx"],
				opts,
			);

			expect(problems.map((p) => p.path)).toEqual(["components/stat-card.tsx", "PRODUCT.md", "screens/welcome.tsx"]);
			expect(problems.every((p) => p.message.includes("only DESIGN.md"))).toBe(true);
		});
		test("other tasks can't write context files, with one problem and no compile errors", () => {
			const problems = one("DESIGN.md", "# Design\n\nWarm");
			expect(problems).toHaveLength(1);
			expect(problems[0]!.message).toContain("user's file");
		});
	});
});
