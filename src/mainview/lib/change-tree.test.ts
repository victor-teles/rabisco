import { describe, expect, test } from "bun:test";
import type { ChangedFile } from "../../shared/change-summary";
import { changeTree, folderPaths } from "./change-tree";

const changed = (path: string, additions: number, deletions: number): ChangedFile => ({
	path,
	change: "modified",
	additions,
	deletions,
});

describe("change tree", () => {
	test("groups files into folders, folders first, with summed counts", () => {
		const tree = changeTree([
			changed("screens/home.tsx", 3, 1),
			changed("DESIGN.md", 1, 0),
			changed("screens/about.tsx", 2, 2),
			changed("components/card.tsx", 1, 4),
		]);

		expect(tree.map((node) => node.name)).toEqual(["components", "screens", "DESIGN.md"]);
		expect(tree[1]).toMatchObject({ kind: "folder", path: "screens", additions: 5, deletions: 3 });
		expect(tree[1]?.kind === "folder" && tree[1].children.map((node) => node.name)).toEqual(["about.tsx", "home.tsx"]);
	});

	test("joins a chain of single folders into one row", () => {
		const tree = changeTree([
			changed("src/mainview/views/editor/chat-panel.tsx", 25, 26),
			changed("src/shared/a.ts", 1, 21),
		]);

		const src = tree[0];

		expect(src).toMatchObject({ name: "src", additions: 26, deletions: 47 });
		expect(src?.kind === "folder" && src.children.map((node) => node.name)).toEqual([
			"mainview/views/editor",
			"shared",
		]);
		expect(folderPaths(tree)).toEqual(["src", "src/mainview/views/editor", "src/shared"]);
	});
});
