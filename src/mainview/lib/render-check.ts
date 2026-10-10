// Check 5 of decision 0003.

import type { Problem } from "../../shared/ai/contract";
import { screensUsing } from "../../shared/components/usages";
import { isComponentFile, isScreenFile } from "../../shared/project";
import type { FileChange, ProjectFiles } from "../../shared/types";

export type RenderCheck = {
	screens: string[];
	/** Untouched screen → the written components it uses, directly or transitively. */
	via: Map<string, string[]>;
};

/** Includes screens using written components: a renamed prop can break screens the generation never touched. */
export function renderCheckOf(files: ProjectFiles, changes: FileChange[]): RenderCheck {
	const written = changes.flatMap((c) => (c.content !== null && c.path in files ? [c.path] : []));
	const direct = new Set(written.filter(isScreenFile));

	const via = new Map(
		[...screensUsing(files, written.filter(isComponentFile))].filter(([screen]) => !direct.has(screen)),
	);

	return { screens: [...direct, ...via.keys()], via };
}

export type RenderRepair = { targets: string[]; problems: Problem[] };

/** Targets the guilty components too, so the fix can land in the component or at its call sites. */
export function renderRepairOf(
	failures: { entry: string; problem: Problem }[],
	via: Map<string, string[]>,
): RenderRepair {
	const targets = new Set<string>();

	const problems = failures.map(({ entry, problem }) => {
		targets.add(problem.path);
		const components = via.get(entry);

		if (!components?.length) return problem;
		targets.add(entry);

		for (const component of components) targets.add(component);

		return { ...problem, message: `${problem.message} (${entry} uses ${components.join(", ")}, which just changed)` };
	});

	return { targets: [...targets], problems };
}
