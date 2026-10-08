import { describe, expect, test } from "bun:test";
import { ANALYTICS, compiles, DASHBOARD } from "../../shared/jsx/test-fixtures";
import { pasteCopy, usedImports } from "./element-clipboard";

describe("usedImports", () => {
	test("the named imports the code mentions", () => {
		const code = `<Button variant="ghost" onClick={() => cn("a")}>\n\t<Bell className="size-5" />\n</Button>`;
		expect(usedImports(DASHBOARD, code)).toEqual([
			{ from: "lucide-react", names: ["Bell"] },
			{ from: "@/components/ui/button", names: ["Button"] },
			{ from: "@/lib/utils", names: ["cn"] },
		]);
	});

	test("skips names that only appear inside others or as properties", () => {
		expect(usedImports(DASHBOARD, `<p className={x.Search}>CardContents</p>`)).toEqual([]);
	});
});

describe("pasteCopy", () => {
	test("pastes into another screen and adds what it imports", () => {
		const copy = {
			code: `<Button>\n\t<Bell />\n</Button>`,
			imports: usedImports(DASHBOARD, `<Button><Bell /></Button>`),
		};

		const result = pasteCopy(ANALYTICS, ANALYTICS.indexOf("<Card"), copy)!;
		expect(result.source).toContain(`import { Button } from "@/components/ui/button";`);
		expect(result.source).toContain(`import { Bell } from "lucide-react";`);
		expect(result.source.slice(result.start).startsWith("<Button>\n")).toBe(true);
		expect(compiles(result.source)).toBe(true);
	});

	test("null when the code can't go there", () => {
		expect(pasteCopy(ANALYTICS, 0, { code: "<b />", imports: [] })).toBeNull();
	});
});
