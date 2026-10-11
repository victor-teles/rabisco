import { describe, expect, test } from "bun:test";
import { editLink, type LinkEdit } from "../../../shared/prototype/links";
import type { Frame } from "../../../shared/types";
import type { ElementRef } from "./canvas";
import { linkActions, linkState } from "./link-actions";

const HOME = `export default function Home() {
	return (
		<main>
			<button data-link-to="screens/settings.tsx">Settings</button>
			<a data-link-to={target}>Code</a>
			<p>Hi</p>
		</main>
	);
}
`;

const FILES = {
	"screens/home.tsx": HOME,
	"screens/settings.tsx": "export default () => <div />;",
	"screens/profile.tsx": "export default () => <div />;",
};

const frame = (file: string, name: string): Frame => ({
	file,
	name,
	device: "mobile",
	x: 0,
	y: 0,
	width: 390,
	height: 844,
});

const FRAMES = [
	frame("screens/home.tsx", "Home"),
	frame("screens/settings.tsx", "Settings"),
	frame("screens/profile.tsx", "Profile"),
];

const at = (needle: string): ElementRef => ({ file: "screens/home.tsx", start: HOME.indexOf(needle) });

describe("linkState", () => {
	test("reads the element's literal link", () => {
		expect(linkState(FILES, at("<button"))).toEqual({
			editable: true,
			written: "screens/settings.tsx",
			current: "screens/settings.tsx",
		});
		expect(linkState(FILES, at("<p"))).toEqual({ editable: true, written: null, current: null });
	});

	test("a link written as code or no element can't be edited", () => {
		expect(linkState(FILES, at("<a")).editable).toBe(false);
		expect(linkState(FILES, null).editable).toBe(false);
	});
});

describe("linkActions", () => {
	test("lists the other screens, checks the current target and writes the link as one edit", () => {
		const edits: [ElementRef, LinkEdit][] = [];
		const element = at("<button");

		const actions = linkActions({
			element,
			files: FILES,
			frames: FRAMES,
			changeLink: (ref, edit) => edits.push([ref, edit]),
		});

		expect(actions.map((action) => action.label)).toEqual(["Settings", "Profile", "Back", "Remove link"]);
		expect(actions.map((action) => action.checked)).toEqual([true, false, false, undefined]);
		expect(actions.every((action) => action.enabled)).toBe(true);

		actions[1]!.run();
		actions[3]!.run();
		expect(edits).toEqual([
			[element, { to: "screens/profile.tsx" }],
			[element, { to: null }],
		]);
		expect(editLink(HOME, element.start, edits[0]![1])).toContain(`<button data-link-to="screens/profile.tsx">`);
	});

	test("Remove link is off on an element without a link, and everything is off on a link in code", () => {
		const noop = () => {};

		const plain = linkActions({ element: at("<p"), files: FILES, frames: FRAMES, changeLink: noop });
		expect(plain.find((action) => action.id === "remove-link")?.enabled).toBe(false);

		const code = linkActions({ element: at("<a"), files: FILES, frames: FRAMES, changeLink: noop });
		expect(code.some((action) => action.enabled)).toBe(false);
	});
});
