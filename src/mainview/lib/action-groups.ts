import type { Action } from "./actions";

export type ActionGroup = { group: string; actions: Action[] };

/** The actions that pass, bucketed by `group` in the order each group first appears */
export function groupActions(actions: readonly Action[], include: (action: Action) => boolean): ActionGroup[] {
	const groups = new Map<string, Action[]>();

	for (const action of actions) {
		if (!include(action)) continue;
		const bucket = groups.get(action.group);

		if (bucket) bucket.push(action);
		else groups.set(action.group, [action]);
	}

	return Array.from(groups, ([group, members]) => ({ group, actions: members }));
}

export const inPalette = (action: Action) => !action.hidden;

/** Hidden actions too: Escape is still a shortcut worth knowing */
export const hasChords = (action: Action) => Boolean(action.chords?.length);
