/**
 * Check 5 of decision 0003 after a generation lands: which frames must
 * render, and the repair to ask for when they don't. Pure, for tests.
 */

import type { Problem } from "../../shared/ai/contract";
import { screensUsing } from "../../shared/components/usages";
import { isComponentFile, isScreenFile } from "../../shared/project";
import type { FileChange, ProjectFiles } from "../../shared/types";

/** The screens whose frames must render after a generation, and why. */
export type RenderCheck = {
	screens: string[];
	/** Screens it didn't write that use components it wrote (directly or through other components) → those components */
	via: Map<string, string[]>;
};

/**
 * What to watch after a generation wrote `changes` (`files` is the project
 * with them applied): the screens it wrote, plus every screen that uses a
 * component it wrote. Renaming a required prop in `components/x.tsx` can
 * break screens the generation never touched.
 */
export function renderCheckOf(files: ProjectFiles, changes: FileChange[]): RenderCheck {
	const written = changes.filter((c) => c.content !== null && c.path in files).map((c) => c.path);
	const direct = new Set(written.filter(isScreenFile));
	const via = new Map([...screensUsing(files, written.filter(isComponentFile))].filter(([screen]) => !direct.has(screen)));
	return { screens: [...direct, ...via.keys()], via };
}

/**
 * The repair for render errors: the failing files, plus the components that
 * broke screens the generation didn't write, so the fix can land in the
 * component or at its call sites. Problems of those screens say which
 * component changed.
 */
export function renderRepairOf(failures: { entry: string; problem: Problem }[], via: Map<string, string[]>): { targets: string[]; problems: Problem[] } {
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
