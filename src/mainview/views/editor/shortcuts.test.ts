import { describe, expect, test } from "bun:test";
import { ownsKey, treeOwnsKey, type KeyTarget } from "./shortcuts";

describe("treeOwnsKey", () => {
	test("the structure tree keeps ⌫ and arrows from the canvas (delete screen, nudge)", () => {
		for (const key of ["Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])
			expect(treeOwnsKey(key)).toBe(true);

		for (const key of ["Enter", "Escape", "v", "Home"]) expect(treeOwnsKey(key)).toBe(false);
	});
});

type Fake = { tagName: string; isContentEditable?: boolean; role?: string; parent?: Fake };

// Matches the selectors ownsKey uses by tag name and role, walking up like Element.closest
function element(fake: Fake): KeyTarget {
	const matches = (node: Fake, selector: string) =>
		selector
			.split(",")
			.map((part) => part.trim())
			.some(
				(part) =>
					part === node.tagName.toLowerCase() ||
					(part === "a[href]" && node.tagName === "A") ||
					(node.role !== undefined && part === `[role=${node.role}]`),
			);

	const closest = (node: Fake | undefined, selector: string): KeyTarget | null =>
		!node ? null : matches(node, selector) ? element(node) : closest(node.parent, selector);

	return { ...fake, closest: (selector) => closest(fake, selector) };
}

const press = (
	target: KeyTarget | null,
	modifiers: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {},
) => ownsKey(target, { metaKey: false, ctrlKey: false, altKey: false, ...modifiers });

describe("ownsKey", () => {
	const aside: Fake = { tagName: "ASIDE" };

	test("text fields, selects and contenteditable own every key", () => {
		for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
			expect(press(element({ tagName, parent: aside }))).toBe(true);
			expect(press(element({ tagName }), { metaKey: true })).toBe(true);
		}

		expect(press(element({ tagName: "DIV", isContentEditable: true }))).toBe(true);
	});

	test("a focused button in a panel keeps ⌫ and arrows, but not ⌘ shortcuts", () => {
		const button = element({ tagName: "BUTTON", parent: { tagName: "DIV", parent: aside } });
		expect(press(button)).toBe(true);
		expect(press(button, { metaKey: true })).toBe(false);

		const icon = element({ tagName: "svg", parent: { tagName: "BUTTON", parent: aside } });
		expect(press(icon)).toBe(true);

		const tab = element({ tagName: "DIV", role: "tab", parent: aside });
		expect(press(tab)).toBe(true);

		const menuItem = element({ tagName: "DIV", role: "menuitem", parent: { tagName: "DIV", role: "menu" } });
		expect(press(menuItem)).toBe(true);
	});

	test("the body, the canvas and the floating toolbar leave keys to the canvas", () => {
		expect(press(element({ tagName: "BODY" }))).toBe(false);
		expect(press(element({ tagName: "DIV", parent: { tagName: "MAIN" } }))).toBe(false);
		expect(press(element({ tagName: "BUTTON", parent: { tagName: "DIV" } }))).toBe(false);
		expect(press(element({ tagName: "DIV", parent: aside }))).toBe(false);
		expect(press(null)).toBe(false);
	});
});
