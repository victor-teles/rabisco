import { describe, expect, test } from "bun:test";
import { groupActions, hasChords, inPalette } from "./action-groups";
import type { Action } from "./actions";

const action = (id: string, group: string, extra: Partial<Action> = {}): Action => ({
	id,
	label: id,
	group,
	enabled: true,
	run: () => {},
	...extra,
});

const ids = (groups: ReturnType<typeof groupActions>) =>
	groups.map((entry) => [entry.group, entry.actions.map((member) => member.id)]);

describe("groupActions", () => {
	test("keeps the order groups first appear in, and the order within each", () => {
		const actions = [action("undo", "Edit"), action("fit", "View"), action("redo", "Edit")];

		expect(ids(groupActions(actions, () => true))).toEqual([
			["Edit", ["undo", "redo"]],
			["View", ["fit"]],
		]);
	});

	test("the palette leaves out hidden actions, and drops a group left empty", () => {
		const actions = [action("escape", "Keys", { hidden: true }), action("undo", "Edit")];

		expect(ids(groupActions(actions, inPalette))).toEqual([["Edit", ["undo"]]]);
	});

	test("the sheet keeps hidden actions with keys and leaves out the ones without", () => {
		const actions = [
			action("escape", "Edit", { hidden: true, chords: [{ key: "Escape" }] }),
			action("export", "Export"),
			action("empty", "Export", { chords: [] }),
		];

		expect(ids(groupActions(actions, hasChords))).toEqual([["Edit", ["escape"]]]);
	});
});
