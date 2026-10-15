import type { ProjectFiles } from "../types";
import { applyTokenEdit, seedDesignTokens, type TokenEdit } from "./token-edit";
import { detachTokenUsages, renameTokenUsages, replaceRawMatches, type RawMatch } from "./token-usage";
import { designTokensOf, type DesignTokens } from "./tokens";

/** One change from the design system view; each is one undo step over DESIGN.md and the screens */
export type DesignSystemChange =
	| { kind: "token"; edit: TokenEdit }
	/** `detach` writes the value into every use first, so screens keep their look */
	| { kind: "remove"; name: string; detach: boolean }
	| { kind: "detach"; name: string }
	| { kind: "replace-raw"; matches: RawMatch[] };

/** The project's files after the change. A rename rewrites the token's uses; DESIGN.md is seeded from the applied
 * theme first, like every token edit. */
export function applyDesignSystemChange(
	files: ProjectFiles,
	applied: DesignTokens | undefined,
	change: DesignSystemChange,
): ProjectFiles {
	const design = seedDesignTokens(files["DESIGN.md"] ?? "", applied);
	const tokens = designTokensOf(design);

	const withDesign = (markdown: string, changed: ProjectFiles = {}) => ({
		...files,
		...changed,
		"DESIGN.md": markdown,
	});

	switch (change.kind) {
		case "token": {
			const { edit } = change;
			const next = applyTokenEdit(design, edit);

			return edit.kind === "rename" && edit.from !== edit.to
				? withDesign(next, renameTokenUsages(files, edit.from, edit.to))
				: withDesign(next);
		}

		case "remove": {
			const next = applyTokenEdit(design, { kind: "remove", name: change.name });

			return withDesign(next, change.detach ? detachTokenUsages(files, change.name, tokens) : {});
		}

		case "detach":
			return { ...files, ...detachTokenUsages(files, change.name, tokens) };
		case "replace-raw":
			return { ...files, ...replaceRawMatches(files, change.matches) };
	}
}
