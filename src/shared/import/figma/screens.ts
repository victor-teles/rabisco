import { validateToken } from "../../context/tokens";
import type { CapturedTree } from "../captured-tree";
import { treeToTsx, type ImportedScreen } from "../to-tsx";
import type { FigmaToken } from "./to-captured";

export type FigmaScreens = {
	screens: ImportedScreen[];
	added: Record<string, string>;
	kept: string[];
	placeholders: number;
};

export function figmaScreens(
	trees: CapturedTree[],
	tokens: FigmaToken[],
	project: Record<string, string>,
	theme: Record<string, string>,
	placeholders = 0,
): FigmaScreens {
	const added: Record<string, string> = {};
	const kept: string[] = [];

	for (const { name, value } of tokens) {
		if (validateToken(name, value)) continue;
		const current = project[name];

		if (current === undefined) added[name] = value;
		else if (current !== value) kept.push(name);
	}

	const matched = { ...theme, ...added };
	const screens = trees.map((tree) => treeToTsx(tree, matched, tree.title || "Imported"));

	return { screens, added, kept, placeholders };
}
