import { describe, expect, test } from "bun:test";
import { parseJsx } from "../../shared/jsx";
import { buildOutline, findNode, remapStart, visibleRows, type OutlineNode } from "./outline";

const SCREEN = `import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "../components/stat-card";

export default function Home({ items, open }: { items: string[]; open: boolean }) {
	return (
		<main className="flex flex-col gap-4 p-6">
			<h1 className="text-2xl font-semibold">Welcome back</h1>
			<StatCard label="Revenue" value="$12k" />
			{items.map((item) => (
				<li key={item}>{item}</li>
			))}
			{open && <Button icon={<Star />}>Save</Button>}
			<>
				<span />
			</>
		</main>
	);
}
`;

const labels = (nodes: OutlineNode[]) => nodes.map((node) => node.label);

describe("buildOutline", () => {
	const outline = buildOutline("screens/home.tsx", SCREEN);
	const main = outline.roots[0]!;

	test("builds the tree with labels and kinds", () => {
		expect(outline.ok).toBe(true);
		expect(labels(outline.roots)).toEqual(["main"]);
		expect(labels(main.children)).toEqual(["h1", "StatCard", "li", "Button", "Fragment"]);
		expect(main.kind).toBe("intrinsic");
		expect(main.children[1]!.kind).toBe("component");
		expect(main.children[4]!.kind).toBe("fragment");
	});

	test("hints: text first, then classes, then a string prop", () => {
		expect(main.hint).toBe("flex flex-col …");
		expect(main.children[0]!.hint).toBe("“Welcome back”");
		expect(main.children[1]!.hint).toBe('label="Revenue"');
	});

	test("marks repeated, conditional and prop elements", () => {
		expect(main.children[2]!.context).toEqual({ kind: "map" });
		const button = main.children[3]!;
		expect(button.context).toEqual({ kind: "conditional" });
		expect(button.children[0]!.label).toBe("Star");
		expect(button.children[0]!.context).toEqual({ kind: "prop", name: "icon" });
		expect(main.children[0]!.context).toBeNull();
	});

	test("resolves component references", () => {
		expect(main.children[1]!.component).toEqual({
			source: "project",
			path: "components/stat-card.tsx",
			exportName: "StatCard",
		});
		expect(main.children[3]!.component).toEqual({ source: "ui", module: "button", exportName: "Button" });
		expect(main.children[3]!.children[0]!.component).toEqual({
			source: "other",
			module: "lucide-react",
			exportName: "Star",
		});
		expect(main.component).toBeNull();
	});

	test("reports files that don't parse", () => {
		const broken = buildOutline("screens/a.tsx", "export default function A() { return <div>; }");
		expect(broken.ok).toBe(false);
		expect(broken.roots).toEqual([]);
	});
});

describe("visibleRows and findNode", () => {
	const outline = buildOutline("screens/home.tsx", SCREEN);

	test("collapsed nodes hide their descendants", () => {
		expect(visibleRows(outline.roots, new Set()).length).toBe(8);
		expect(labels(visibleRows(outline.roots, new Set(["0"])))).toEqual(["main"]);
		expect(labels(visibleRows(outline.roots, new Set(["0.3"])))).toEqual([
			"main",
			"h1",
			"StatCard",
			"li",
			"Button",
			"Fragment",
			"span",
		]);
	});

	test("finds a node with its ancestors", () => {
		const star = SCREEN.indexOf("<Star");
		const found = findNode(outline.roots, star)!;
		expect(found.node.label).toBe("Star");
		expect(labels(found.ancestors)).toEqual(["main", "Button"]);
		expect(findNode(outline.roots, star + 1)).toBeNull();
	});
});

describe("remapStart", () => {
	const start = SCREEN.indexOf("<StatCard");

	test("keeps the element when the edit is after it or inside it", () => {
		expect(remapStart(SCREEN, SCREEN.replace("Save", "Save all"), start)).toBe(start);
		expect(remapStart(SCREEN, SCREEN.replace('"Revenue"', '"Sales"'), start)).toBe(start);
	});

	test("shifts the element when the edit is before it", () => {
		const next = SCREEN.replace("Welcome back", "Hello");
		expect(remapStart(SCREEN, next, start)).toBe(next.indexOf("<StatCard"));
	});

	test("finds it by tree position after edits around it", () => {
		const next = `// header\n${SCREEN.replace("Welcome back", "Hi").replace("Save", "Go")}`;
		expect(remapStart(SCREEN, next, start)).toBe(next.indexOf("<StatCard"));
	});

	test("is null when the element is gone or the file doesn't parse", () => {
		expect(remapStart(SCREEN, SCREEN.replace('<StatCard label="Revenue" value="$12k" />', ""), start)).toBeNull();
		expect(remapStart(SCREEN, SCREEN.replace("</main>", ""), start)).toBeNull();
		expect(remapStart(SCREEN, SCREEN, start + 1)).toBe(start + 1);
		expect(parseJsx(SCREEN).ok).toBe(true);
	});
});
