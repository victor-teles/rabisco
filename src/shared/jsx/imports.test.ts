import { describe, expect, test } from "bun:test";
import { addImport, readImports, removeUnusedImports } from "./imports";
import { compiles, DASHBOARD } from "./test-fixtures";

describe("readImports", () => {
	test("default, namespace, named, aliased and type imports", () => {
		const source = `import React, { useState as useS } from "react";
import * as Icons from 'lucide-react';
import type { LucideIcon } from "lucide-react";
import {
	Card,
	type CardProps,
} from "@/components/ui/card"
import "./side-effect";
const lazy = import("./x");
`;

		const imports = readImports(source);
		expect(imports.map((d) => d.module)).toEqual([
			"react",
			"lucide-react",
			"lucide-react",
			"@/components/ui/card",
			"./side-effect",
		]);
		expect(imports[0]).toMatchObject({
			defaultName: "React",
			named: [{ imported: "useState", local: "useS", type: false }],
			semicolon: true,
		});
		expect(imports[1]).toMatchObject({ namespace: "Icons", quote: "'" });
		expect(imports[2]).toMatchObject({ typeOnly: true, named: [{ local: "LucideIcon" }] });
		expect(imports[3]).toMatchObject({
			semicolon: false,
			named: [{ local: "Card" }, { local: "CardProps", type: true }],
		});
	});
});

describe("addImport", () => {
	test("merges into the import of the same module, without duplicates", () => {
		const out = addImport(DASHBOARD, "lucide-react", ["Bell", "Star", "Star"]);
		expect(out).toContain(`import { ArrowUpRight, Bell, Search, Star } from "lucide-react";`);
		expect(addImport(out, "lucide-react", ["Star"])).toBe(out);
		expect(compiles(out)).toBe(true);
	});

	test("adds a line after the last import", () => {
		const out = addImport(DASHBOARD, "../components/stat-card", ["StatCard"]);
		expect(out).toContain(
			`import { TabBar } from "../components/tab-bar";\nimport { StatCard } from "../components/stat-card";\n`,
		);
	});

	test("keeps multi-line braces multi-line, and quote and semicolon style", () => {
		const source = `import {\n\tCard,\n} from '@/components/ui/card'\n\nexport const x = 1\n`;
		expect(addImport(source, "@/components/ui/card", ["CardTitle"])).toBe(
			`import {\n\tCard,\n\tCardTitle,\n} from '@/components/ui/card'\n\nexport const x = 1\n`,
		);
		expect(addImport(source, "react", ["useState"])).toStartWith(
			`import {\n\tCard,\n} from '@/components/ui/card'\nimport { useState } from 'react'\n`,
		);
	});

	test("adds to a default import, or at the top of a file without imports", () => {
		expect(addImport(`import React from "react";\n`, "react", ["useState"])).toBe(
			`import React, { useState } from "react";\n`,
		);
		expect(addImport(`export function A() {\n\treturn <div />;\n}\n`, "react", ["useState"])).toBe(
			`import { useState } from "react";\n\nexport function A() {\n\treturn <div />;\n}\n`,
		);
		expect(addImport("", "react", ["useState"])).toBe(`import { useState } from "react";\n`);
	});

	test("unparsable source comes back unchanged", () => {
		expect(addImport("const a = <div>", "react", ["useState"])).toBe("const a = <div>");
	});
});

describe("removeUnusedImports", () => {
	test("drops only the listed names that nothing uses", () => {
		const source = `import { Bell, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function A() {
	return <Card className={cn("a")}><Bell /></Card>;
}
`;

		const out = removeUnusedImports(source, ["Star", "Card", "Bell", "cn"]);
		expect(out).toContain(`import { Bell } from "lucide-react";`);
		expect(out).toContain("import { Card }");
		expect(out).toContain("import { cn }");
		const gone = removeUnusedImports(source.replace("<Bell />", ""), ["Bell", "Star"]);
		expect(gone).not.toContain("lucide-react");
		expect(gone.startsWith(`import { Card }`)).toBe(true);
		expect(compiles(gone)).toBe(true);
	});

	test("a property or object key with the same name is not a use", () => {
		const source = `import { Star } from "lucide-react";\nconst a = { Star: 1 };\nconst b = a.Star;\n`;
		expect(removeUnusedImports(source, ["Star"])).toBe(`const a = { Star: 1 };\nconst b = a.Star;\n`);
	});
});
