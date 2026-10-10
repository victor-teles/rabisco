import { describe, expect, test } from "bun:test";
import { codeToCopy, importSpecifiers, localDependencies } from "./code";

const files = {
	"screens/home.tsx": `import { Button } from "@/components/ui/button";
import { StatCard } from "../components/stat-card";
import type { Props } from "../components/types";
import { Missing } from "../components/missing";

export default function Home() {
	return <p>Imported from "nowhere"</p>;
}
`,
	"components/stat-card.tsx": `import {
	Card,
	CardContent,
} from "@/components/ui/card";
import { Trend } from "./trend";

export function StatCard() {
	return <Card><CardContent><Trend /></CardContent></Card>;
}
`,
	"components/trend.tsx": `import { StatCard } from "./stat-card";\nexport function Trend() {\n\treturn null;\n}\n`,
	"components/types.ts": "export type Props = {};\n",
	"components/unused.tsx": "export function Unused() {\n\treturn null;\n}\n",
};

describe("imports", () => {
	test("finds every import form, multi-line ones included", () => {
		expect(importSpecifiers(files["screens/home.tsx"])).toEqual([
			"@/components/ui/button",
			"../components/stat-card",
			"../components/types",
			"../components/missing",
		]);
		expect(importSpecifiers(files["components/stat-card.tsx"])).toEqual(["@/components/ui/card", "./trend"]);
		expect(importSpecifiers('import "./side-effect";\nexport { x } from "./x";')).toEqual(["./side-effect", "./x"]);
	});

	test("local dependencies are transitive, in import order, cycles and missing files skipped", () => {
		expect(localDependencies(files, "screens/home.tsx")).toEqual([
			"components/stat-card.tsx",
			"components/trend.tsx",
			"components/types.ts",
		]);
		expect(localDependencies(files, "components/trend.tsx")).toEqual(["components/stat-card.tsx"]);
		expect(localDependencies(files, "components/unused.tsx")).toEqual([]);
	});
});

describe("code to copy", () => {
	test("a file alone is its source, verbatim", () => {
		expect(codeToCopy(files, "screens/home.tsx")).toBe(files["screens/home.tsx"]);
	});

	test("with components, each file is headed by its path", () => {
		const code = codeToCopy(files, "screens/home.tsx", true);
		expect(code.startsWith(`// screens/home.tsx\n${files["screens/home.tsx"]}`)).toBe(true);
		expect(code).toContain(`\n// components/stat-card.tsx\n${files["components/stat-card.tsx"]}`);
		expect(code).toContain("// components/trend.tsx\n");
		expect(code).toContain("// components/types.ts\n");
		expect(code).not.toContain("unused");
	});

	test("a missing file throws", () => {
		expect(() => codeToCopy(files, "screens/gone.tsx")).toThrow();
	});
});
