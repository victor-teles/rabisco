import { describe, expect, test } from "bun:test";
import { FRAME_GAP, FRAME_SIZE } from "../project";
import type { GenerationEvent } from "./contract";
import {
	clampVariations,
	collapseComponents,
	combineVariations,
	createVariantRenamer,
	remapScreens,
	renameChanges,
	rewriteImports,
	variantComponentPath,
	variantScreenPath,
	variationsNote,
	type VariantOutput,
} from "./variants";

const SCREEN = (component = "row") => `import { Row } from "../components/${component}";\nexport default function A() { return <Row /> }\n`;
const ROW = `export function Row() { return <div /> }\n`;
const map = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("names", () => {
	test("clamp", () => {
		expect(clampVariations(undefined)).toBe(1);
		expect(clampVariations(0)).toBe(1);
		expect(clampVariations(3)).toBe(3);
		expect(clampVariations(9)).toBe(4);
		expect(clampVariations(Number.NaN)).toBe(1);
	});

	test("screens take the next alternate number plus k - 1", () => {
		const taken = ["screens/welcome.tsx", "screens/welcome.alt-1.tsx"];
		expect(variantScreenPath("screens/welcome.tsx", 1, taken)).toBe("screens/welcome.alt-2.tsx");
		expect(variantScreenPath("screens/welcome.tsx", 3, taken)).toBe("screens/welcome.alt-4.tsx");
		expect(variantScreenPath("screens/welcome.alt-1.tsx", 1, taken)).toBe("screens/welcome.alt-2.tsx");
		expect(variantScreenPath("screens/new.tsx", 2, taken)).toBe("screens/new.alt-2.tsx");
	});

	test("components get -v<k+1>, avoiding project names", () => {
		expect(variantComponentPath("components/row.tsx", 1, [])).toBe("components/row-v2.tsx");
		expect(variantComponentPath("components/row.tsx", 2, ["components/row-v3.tsx"])).toBe("components/row-v3-2.tsx");
	});

	test("rewrites component imports from screens and components", () => {
		const renames = map({ "components/row.tsx": "components/row-v2.tsx" });
		expect(rewriteImports("screens/a.tsx", SCREEN(), renames)).toBe(SCREEN("row-v2"));
		expect(rewriteImports("components/list.tsx", `import { Row } from './row';`, renames)).toBe(`import { Row } from './row-v2';`);
		expect(rewriteImports("components/list.tsx", `import { Row } from "../components/row";`, renames)).toContain(`"../components/row-v2"`);
		// `./x` from a screen is not a component import
		expect(rewriteImports("screens/a.tsx", `import x from "./row";`, renames)).toBe(`import x from "./row";`);
		expect(rewriteImports("screens/a.tsx", SCREEN("rowing"), renames)).toBe(SCREEN("rowing"));
	});

	test("renameChanges renames paths and imports together", () => {
		const changes = renameChanges(
			[
				{ path: "screens/a.alt-1.tsx", content: SCREEN("row-v2") },
				{ path: "components/row-v2.tsx", content: ROW },
			],
			map({ "screens/a.alt-1.tsx": "screens/a.tsx", "components/row-v2.tsx": "components/row.tsx" }),
		);
		expect(changes).toEqual([
			{ path: "screens/a.tsx", content: SCREEN() },
			{ path: "components/row.tsx", content: ROW },
		]);
	});
});

describe("live renaming", () => {
	const run = (variant: number, events: GenerationEvent[], taken: string[] = [], readOnly: string[] = []) => {
		const renamer = createVariantRenamer({ variant, taken, readOnly });
		return { renamer, out: events.flatMap((event) => renamer.transform(event)) };
	};
	const end = (path: string, content: string): GenerationEvent => ({ type: "file.end", path, content });

	test("variant 0 passes everything through, except read-only paths", () => {
		const events: GenerationEvent[] = [end("screens/a.tsx", SCREEN()), { type: "file.delete", path: "screens/b.tsx" }, end("screens/ref.tsx", "x")];
		expect(run(0, events, [], ["screens/ref.tsx"]).out).toEqual(events.slice(0, 2));
	});

	test("screens become alternates, components -v<k+1>, and earlier files are re-sent with new imports", () => {
		const { out, renamer } = run(
			2,
			[
				{ type: "status", label: "Thinking" },
				{ type: "file.start", path: "screens/a.tsx", kind: "screen", screen: { name: "A" } },
				end("screens/a.tsx", SCREEN()),
				{ type: "file.start", path: "components/row.tsx", kind: "component" },
				{ type: "file.delta", path: "components/row.tsx", text: ROW },
				end("components/row.tsx", ROW),
				{ type: "file.delete", path: "screens/old.tsx" },
				end("screens/a.alt-2.tsx", SCREEN()),
			],
			["screens/a.tsx"],
		);
		expect(out).toEqual([
			{ type: "status", label: "Thinking" },
			{ type: "file.start", path: "screens/a.alt-2.tsx", kind: "screen", screen: { name: "A" } },
			end("screens/a.alt-2.tsx", SCREEN()),
			{ type: "file.start", path: "components/row-v3.tsx", kind: "component" },
			end("screens/a.alt-2.tsx", SCREEN("row-v3")),
			{ type: "file.delta", path: "components/row-v3.tsx", text: ROW },
			end("components/row-v3.tsx", ROW),
			// A repair turn writes the assigned name: it passes through
			end("screens/a.alt-2.tsx", SCREEN("row-v3")),
		]);
		expect([...renamer.assigned]).toEqual(["screens/a.alt-2.tsx", "components/row-v3.tsx"]);
		expect(renamer.renames.get("components/row.tsx")).toBe("components/row-v3.tsx");
	});
});

describe("combining", () => {
	test("collapses components that came out the same, with their dependents", () => {
		const renames = map({ "components/row.tsx": "components/row-v2.tsx", "components/list.tsx": "components/list-v2.tsx", "components/tag.tsx": "components/tag-v2.tsx" });
		const list = `import { Row } from "./row";\nexport function List() { return <Row /> }\n`;
		const changes = [
			{ path: "screens/a.alt-1.tsx", content: `import { List } from "../components/list-v2";\nimport { Tag } from "../components/tag-v2";\nexport default function A() { return <List /> }` },
			{ path: "components/row-v2.tsx", content: ROW },
			{ path: "components/list-v2.tsx", content: list.replace("./row", "./row-v2") },
			{ path: "components/tag-v2.tsx", content: "export function Tag() { return <b /> }" },
		];
		const reference = (path: string) => ({ "components/row.tsx": ROW, "components/list.tsx": list, "components/tag.tsx": "export function Tag() { return <i /> }" })[path];
		expect(collapseComponents(changes, renames, reference)).toEqual([
			{ path: "screens/a.alt-1.tsx", content: `import { List } from "../components/list";\nimport { Tag } from "../components/tag-v2";\nexport default function A() { return <List /> }` },
			{ path: "components/tag-v2.tsx", content: "export function Tag() { return <b /> }" },
		]);
		// A renamed component that imports one that stays renamed can't collapse
		const different = (path: string) => (path === "components/row.tsx" ? "other" : reference(path));
		expect(collapseComponents(changes, renames, different).map((c) => c.path)).toContain("components/list-v2.tsx");
	});

	test("remaps screens onto the primary's by index and drops extras", () => {
		const changes = [
			{ path: "screens/home.alt-1.tsx", content: "h" },
			{ path: "screens/start.alt-1.tsx", content: "s" },
			{ path: "screens/extra.alt-1.tsx", content: "e" },
		];
		const result = remapScreens(changes, ["screens/welcome.tsx", "screens/home.tsx"], 1, ["screens/welcome.alt-1.tsx"]);
		expect(result.changes).toEqual([
			{ path: "screens/home.alt-1.tsx", content: "h" },
			{ path: "screens/welcome.alt-2.tsx", content: "s" },
		]);
		expect(result.dropped).toEqual(["screens/extra.alt-1.tsx"]);
	});

	const output = (variant: number, changes: [string, string][], renames: Record<string, string> = {}): VariantOutput => ({
		variant,
		changes: changes.map(([path, content]) => ({ path, content })),
		screens: {},
		renames: map(renames),
	});

	test("create: rows are variants, columns are screens", () => {
		const { width, height } = FRAME_SIZE.mobile;
		const combined = combineVariations({
			mode: "create",
			device: "mobile",
			projectFiles: {},
			outputs: [
				output(1, [["screens/a.alt-1.tsx", SCREEN("row-v2")], ["screens/b.alt-1.tsx", "b1"], ["components/row-v2.tsx", ROW]], {
					"screens/a.tsx": "screens/a.alt-1.tsx",
					"screens/b.tsx": "screens/b.alt-1.tsx",
					"components/row.tsx": "components/row-v2.tsx",
				}),
				output(0, [["screens/a.tsx", SCREEN()], ["screens/b.tsx", "b"], ["components/row.tsx", ROW]]),
				output(2, [["screens/other.alt-2.tsx", "o2"]], { "screens/other.tsx": "screens/other.alt-2.tsx" }),
			],
		});
		expect(combined.primary).toBe(0);
		expect(combined.changes.map((c) => c.path)).toEqual([
			"screens/a.tsx",
			"screens/b.tsx",
			"components/row.tsx",
			"screens/a.alt-1.tsx",
			"screens/b.alt-1.tsx",
			"screens/a.alt-2.tsx",
		]);
		expect(combined.changes[3]!.content).toBe(SCREEN());
		expect(combined.frames.map(({ file, x, y }) => [file, x, y])).toEqual([
			["screens/a.tsx", 0, 0],
			["screens/b.tsx", width + FRAME_GAP, 0],
			["screens/a.alt-1.tsx", 0, height + FRAME_GAP],
			["screens/b.alt-1.tsx", width + FRAME_GAP, height + FRAME_GAP],
			["screens/a.alt-2.tsx", 0, 2 * (height + FRAME_GAP)],
		]);
	});

	test("create: the lowest successful variant is promoted when variant 0 failed", () => {
		const combined = combineVariations({
			mode: "create",
			device: "mobile",
			projectFiles: {},
			outputs: [
				output(2, [["screens/a.alt-2.tsx", "a2"]], { "screens/a.tsx": "screens/a.alt-2.tsx" }),
				output(1, [["screens/a.alt-1.tsx", SCREEN("row-v2")], ["components/row-v2.tsx", ROW]], {
					"screens/a.tsx": "screens/a.alt-1.tsx",
					"components/row.tsx": "components/row-v2.tsx",
				}),
			],
		});
		expect(combined.primary).toBe(1);
		expect(combined.changes).toEqual([
			{ path: "screens/a.tsx", content: SCREEN() },
			{ path: "components/row.tsx", content: ROW },
			{ path: "screens/a.alt-2.tsx", content: "a2" },
		]);
		expect(combined.frames.map((f) => f.file)).toEqual(["screens/a.tsx", "screens/a.alt-2.tsx"]);
	});

	test("vary: one frame per new alternate, stacked from the origin", () => {
		const projectFiles = { "screens/a.tsx": SCREEN(), "components/row.tsx": ROW };
		const combined = combineVariations({
			mode: "vary",
			device: "mobile",
			projectFiles,
			outputs: [
				output(1, [["screens/a.alt-1.tsx", SCREEN("row-v2")], ["components/row-v2.tsx", ROW]], {
					"screens/a.tsx": "screens/a.alt-1.tsx",
					"components/row.tsx": "components/row-v2.tsx",
				}),
				output(2, [["screens/a.alt-2.tsx", SCREEN("row-v3")], ["components/row-v3.tsx", "export function Row() { return <p /> }"]], {
					"screens/a.tsx": "screens/a.alt-2.tsx",
					"components/row.tsx": "components/row-v3.tsx",
				}),
			],
		});
		expect(combined.primary).toBeNull();
		expect(combined.changes.map((c) => c.path)).toEqual(["screens/a.alt-1.tsx", "screens/a.alt-2.tsx", "components/row-v3.tsx"]);
		expect(combined.changes[0]!.content).toBe(SCREEN());
		expect(combined.frames.map(({ file, x, y }) => [file, x, y])).toEqual([
			["screens/a.alt-1.tsx", 0, 0],
			["screens/a.alt-2.tsx", 0, FRAME_SIZE.mobile.height + FRAME_GAP],
		]);
	});

	test("note", () => {
		expect(variationsNote(1, 0, 0)).toBe("");
		expect(variationsNote(3, 0, 0)).toBe("Made 3 variations.");
		expect(variationsNote(2, 1, 1)).toBe("Made 2 variations. 1 variation failed. Left out 1 extra screen that matched none of the first variation's.");
	});
});
