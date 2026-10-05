import { describe, expect, test } from "bun:test";
import { componentApi } from "../../shared/components/api";
import { LIBRARY } from "../../shared/components/library";
import { componentDrag, componentInsertion, dropParent, hitStarts, insertDrop, libraryInsertion, parseDragItem, screenRoot } from "./component-drop";
import { sourceVersion } from "./render/protocol";

const SCREEN = `import { Button } from "@/components/ui/button";

export default function Home() {
	const items = ["a", "b"];
	return (
		<main className="flex flex-col gap-4 p-6">
			<header className="flex items-center">
				<h1 className="text-xl">Hi <span>there</span></h1>
				<Button>Go</Button>
			</header>
			<ul>
				{items.map((item) => (
					<li key={item}>
						<div className="p-2">{item}</div>
					</li>
				))}
			</ul>
			<img src="x.png" />
		</main>
	);
}
`;

const at = (source: string, needle: string) => {
	const index = source.indexOf(needle);
	if (index < 0) throw new Error(`missing ${needle}`);
	return index;
};

const STAT_CARD = `import type { LucideIcon } from "lucide-react";
export function StatCard({ label, value, icon, tone = "neutral", hint }: { label: string; value: number; icon: LucideIcon; tone?: "neutral" | "good"; hint?: string }) {
	return <div>{label}</div>;
}
export function Pill({ children }: { children: React.ReactNode }) {
	return <span>{children}</span>;
}
`;

describe("componentInsertion", () => {
	const [card, pill] = componentApi("components/stat-card.tsx", STAT_CARD).exports;

	test("writes sample props as readable JSX, with the imports they need", () => {
		const { snippet, imports } = componentInsertion("components/stat-card.tsx", card!);
		expect(snippet).toBe(`<StatCard label="Label" value={42} icon={Star} tone="neutral" />`);
		expect(imports).toEqual([
			{ from: "../components/stat-card", names: ["StatCard"] },
			{ from: "lucide-react", names: ["Star"] },
		]);
	});

	test("components that take children get some text", () => {
		expect(componentInsertion("components/stat-card.tsx", pill!).snippet).toBe(`<Pill>Pill</Pill>`);
	});
});

describe("dropParent", () => {
	test("a container takes the drop itself", () => {
		expect(dropParent(SCREEN, at(SCREEN, "<header"))).toBe(at(SCREEN, "<header"));
	});

	test("text and void elements pass it to their container", () => {
		expect(dropParent(SCREEN, at(SCREEN, "<span>"))).toBe(at(SCREEN, "<header"));
		expect(dropParent(SCREEN, at(SCREEN, "<h1"))).toBe(at(SCREEN, "<header"));
		expect(dropParent(SCREEN, at(SCREEN, "<img"))).toBe(at(SCREEN, "<main"));
	});

	test("elements repeated by .map pass it above the expression", () => {
		expect(dropParent(SCREEN, at(SCREEN, `<div className="p-2"`))).toBe(at(SCREEN, "<main"));
	});

	test("unknown offsets and bad source give null", () => {
		expect(dropParent(SCREEN, 3)).toBeNull();
		expect(dropParent("export default () => <div>", 21)).toBeNull();
	});
});

describe("screenRoot", () => {
	test("the default export's outermost element", () => {
		expect(screenRoot(SCREEN)).toBe(at(SCREEN, "<main"));
		const named = `function Row() {\n\treturn <li />;\n}\nfunction Page() {\n\treturn <section><Row /></section>;\n}\nexport default Page;\n`;
		expect(screenRoot(named)).toBe(at(named, "<section"));
	});

	test("the main return, not JSX built before it, an early return or a nested function", () => {
		const source = `export default function Page({ list }: { list: string[] }) {
	const items = list.map((l) => <li key={l}>{l}</li>);
	if (!list.length) return <Empty />;
	function helper() {
		return <p>nested</p>;
	}
	return (
		<main>
			<ul>{items}</ul>
		</main>
	);
}
`;
		expect(screenRoot(source)).toBe(at(source, "<main"));
	});

	test("arrows, const declarations and wrappers", () => {
		const arrow = `const x = <b />;\nexport default () => (\n\t<section><p /></section>\n);\n`;
		expect(screenRoot(arrow)).toBe(at(arrow, "<section"));
		const block = `const Page = async (): Promise<any> => {\n\tconst a = <i />;\n\treturn <div />;\n};\nexport default Page;\n`;
		expect(screenRoot(block)).toBe(at(block, "<div"));
		const memo = `export default memo(function Page() {\n\treturn <main />;\n});\n`;
		expect(screenRoot(memo)).toBe(at(memo, "<main"));
	});

	test("prefers an intrinsic container inside a component root; none for a bare usage", () => {
		const layout = `export default function Page() {\n\treturn (\n\t\t<Layout>\n\t\t\t<section />\n\t\t</Layout>\n\t);\n}\n`;
		expect(screenRoot(layout)).toBe(at(layout, "<section"));
		expect(screenRoot(`export default function Page() {\n\treturn <Dashboard />;\n}\n`)).toBeNull();
		expect(screenRoot(`export default function Page() {\n\treturn items.map((i) => <div />);\n}\n`)).toBeNull();
	});
});

describe("drops on helper components and stray JSX", () => {
	const source = `function Row({ label }: { label: string }) {
	return <div className="row">{label}</div>;
}

export default function Screen() {
	const extra = <section>extra</section>;
	return (
		<main>
			<ul>
				{["a", "b"].map((l) => (
					<Row key={l} label={l} />
				))}
			</ul>
		</main>
	);
}
`;

	test("a local helper's element is not a drop target", () => {
		expect(dropParent(source, at(source, `<div className="row"`))).toBeNull();
		expect(dropParent(source, at(source, "<section"))).toBeNull();
	});

	test("the drop goes to the first screen ancestor that takes it", () => {
		// The frame reports the helper's div, then the screen's <ul>, then <main>
		const out = insertDrop(source, [at(source, `<div className="row"`), at(source, "<ul"), at(source, "<main")], { snippet: "<p>Hi</p>", imports: [] })!;
		expect(out).toContain(`\t\t\t</ul>\n\t\t\t<p>Hi</p>\n\t\t</main>`);
		expect(out).toContain(`return <div className="row">{label}</div>;`);
		// Nothing usable: the root
		expect(insertDrop(source, [at(source, `<div className="row"`)], { snippet: "<p>Hi</p>", imports: [] })).toContain(`\t\t\t<p>Hi</p>\n\t\t</main>`);
	});
});

describe("insertDrop", () => {
	test("inserts at the drop point and adds the imports", () => {
		const out = insertDrop(SCREEN, at(SCREEN, "<h1"), {
			snippet: `<StatCard label="Revenue" />`,
			imports: [{ from: "../components/stat-card", names: ["StatCard"] }],
		})!;
		expect(out).toContain(`\t\t\t\t<Button>Go</Button>\n\t\t\t\t<StatCard label="Revenue" />\n\t\t\t</header>`);
		expect(out).toContain(`import { StatCard } from "../components/stat-card";`);
	});

	test("falls back to the screen root, and merges existing imports", () => {
		const item = LIBRARY.find((i) => i.id.startsWith("button"))!;
		const out = insertDrop(SCREEN, null, libraryInsertion(item))!;
		expect(out).toContain(`\t\t\t<img src="x.png" />\n\t\t\t${item.snippet.split("\n")[0]}`);
		expect(out.match(/@\/components\/ui\/button/g)!.length).toBe(1);
	});

	test("a component module's location is never used", () => {
		// A hit outside the screen's own elements resolves to null before it gets here; null means the root
		const out = insertDrop(SCREEN, null, { snippet: "<p>Hi</p>", imports: [] })!;
		expect(out).toContain(`\t\t\t<p>Hi</p>\n\t\t</main>`);
	});

	test("bad source gives null", () => {
		expect(insertDrop("export default () => <div>", null, { snippet: "<p />", imports: [] })).toBeNull();
	});
});

describe("hitStarts", () => {
	test("offsets are used only for the source version the frame rendered", () => {
		const hit = { path: "screens/a.tsx", starts: [at(SCREEN, "<h1"), at(SCREEN, "<header")], version: sourceVersion(SCREEN) };
		expect(hitStarts(hit, "screens/a.tsx", SCREEN)).toEqual(hit.starts);
		expect(hitStarts(hit, "screens/b.tsx", SCREEN)).toBeNull();
		// Edited since (or the edit failed to load in the frame): the old offsets would land elsewhere
		const edited = SCREEN.replace("<main", "<div className=\"x\" />\n\t\t<main");
		expect(hitStarts(hit, "screens/a.tsx", edited)).toBeNull();
		expect(hitStarts(null, "screens/a.tsx", SCREEN)).toBeNull();
	});
});

describe("parseDragItem", () => {
	test("accepts only well-formed items", () => {
		expect(parseDragItem(JSON.stringify({ kind: "component", path: "components/a.tsx", name: "A" }))).toEqual({
			kind: "component",
			path: "components/a.tsx",
			name: "A",
		});
		expect(parseDragItem(JSON.stringify({ kind: "library", id: "button" }))).toEqual({ kind: "library", id: "button" });
		expect(parseDragItem("nope")).toBeNull();
		expect(parseDragItem(JSON.stringify({ kind: "component" }))).toBeNull();
	});
});

describe("componentDrag", () => {
	test("keeps the dragged item for the canvas, and notifies on start and end", () => {
		let calls = 0;
		const unsubscribe = componentDrag.subscribe(() => calls++);
		componentDrag.start({ kind: "library", id: "button" });
		expect(parseDragItem(componentDrag.current()!)).toEqual({ kind: "library", id: "button" });
		componentDrag.end();
		componentDrag.end();
		expect(componentDrag.current()).toBeNull();
		expect(calls).toBe(2);
		unsubscribe();
	});
});
