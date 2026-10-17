import { describe, expect, test } from "bun:test";
import { accessibilityFindings, type AccessibleNode, type AccessibleScreen } from "./accessibility-checks";
import type { LayoutBox } from "./layout-checks";

const box = (x: number, y: number, width: number, height: number): LayoutBox => ({ x, y, width, height });

let starts = 0;

function node(fields: Partial<AccessibleNode> = {}): AccessibleNode {
	return {
		loc: `screens/a.tsx:${starts++}`,
		tag: "button",
		role: "button",
		name: "Save",
		namedByPlaceholder: false,
		box: box(0, 0, 120, 44),
		focusable: true,
		tabIndex: 0,
		disabled: false,
		clickOnly: false,
		hasFocusableInside: false,
		inline: false,
		labelled: false,
		strayText: false,
		...fields,
	};
}

const main = () =>
	node({ tag: "main", role: "main", name: "", focusable: false, tabIndex: -1, box: box(0, 0, 390, 844) });

function screen(nodes: AccessibleNode[], touch = true): AccessibleScreen {
	return { nodes: [main(), ...nodes], frame: { width: 390, height: 844 }, touch };
}

const found = (target: AccessibleScreen, rule: string) =>
	accessibilityFindings(target).filter((entry) => entry.finding.rule === rule);

describe("labels", () => {
	test("flags a control with no name, and an image with no alt", () => {
		const icon = node({ name: "" });
		const image = node({ tag: "img", role: "img", name: "", focusable: false, tabIndex: -1 });
		const labels = found(screen([icon, image]), "label");

		expect(labels.map((entry) => entry.loc)).toEqual([icon.loc, image.loc]);
		expect(labels.every((entry) => entry.finding.severity === "error")).toBe(true);
		expect(labels[0]!.finding.message).toContain("aria-label");
	});

	test("warns when only a placeholder names a field", () => {
		const field = node({ tag: "input", role: "textbox", name: "Email", namedByPlaceholder: true });
		const labels = found(screen([field]), "label");

		expect(labels).toHaveLength(1);
		expect(labels[0]!.finding.severity).toBe("warning");
	});

	test("passes named controls and leaves plain text alone", () => {
		const text = node({ tag: "p", role: null, name: "", focusable: false, tabIndex: -1 });

		expect(found(screen([node(), text]), "label")).toEqual([]);
	});
});

describe("focus order", () => {
	test("flags an element that takes clicks but not focus", () => {
		const card = node({ tag: "div", role: null, focusable: false, tabIndex: -1, clickOnly: true });

		const wrapper = node({
			tag: "div",
			role: null,
			focusable: false,
			tabIndex: -1,
			clickOnly: true,
			hasFocusableInside: true,
		});

		const order = found(screen([card, wrapper]), "focus-order");

		expect(order.map((entry) => entry.loc)).toEqual([card.loc]);
		expect(order[0]!.finding.severity).toBe("error");
	});

	test("warns about a positive tabIndex", () => {
		expect(found(screen([node({ tabIndex: 3 })]), "focus-order")[0]?.finding.message).toContain("tabIndex={3}");
	});

	test("warns when Tab goes back up the same column, not across columns", () => {
		const header = node({ name: "Menu", box: box(0, 0, 390, 44) });
		const footer = node({ name: "Next", box: box(0, 700, 390, 44) });

		expect(found(screen([footer, header]), "focus-order")).toHaveLength(1);
		expect(found(screen([header, footer]), "focus-order")).toEqual([]);

		const left = node({ name: "Left card", box: box(0, 300, 180, 44) });
		const right = node({ name: "Right card", box: box(200, 100, 180, 44) });

		expect(found(screen([left, right]), "focus-order")).toEqual([]);
	});
});

describe("tap targets", () => {
	test("errors under 24px and warns under 44px on touch screens", () => {
		const tiny = node({ name: "Close", box: box(0, 0, 16, 16) });
		const small = node({ name: "Edit", box: box(0, 100, 32, 32) });
		const targets = found(screen([tiny, small]), "tap-target");

		expect(targets.map((entry) => entry.finding.severity)).toEqual(["error", "warning"]);
	});

	test("lets desktop screens use 32px targets", () => {
		expect(found(screen([node({ box: box(0, 0, 32, 32) })], false), "tap-target")).toEqual([]);
	});

	test("skips inline links, labelled checkboxes and disabled controls", () => {
		const inline = node({ tag: "a", role: "link", box: box(0, 0, 40, 18), inline: true });
		const checkbox = node({ role: "checkbox", box: box(0, 40, 16, 16), labelled: true });
		const disabled = node({ box: box(0, 80, 16, 16), disabled: true, focusable: false });

		expect(found(screen([inline, checkbox, disabled]), "tap-target")).toEqual([]);
	});
});

describe("landmarks", () => {
	test("warns about a screen without <main>", () => {
		const target: AccessibleScreen = { nodes: [node()], frame: { width: 390, height: 844 }, touch: true };
		const landmarks = found(target, "landmarks");

		expect(landmarks).toHaveLength(1);
		expect(landmarks[0]!.loc).toBeNull();
	});

	test("flags a second <main> and unnamed navs when there are several", () => {
		const nav = () => node({ tag: "nav", role: "navigation", name: "", focusable: false, tabIndex: -1 });
		const landmarks = found(screen([main(), nav(), nav()]), "landmarks");

		expect(landmarks.map((entry) => entry.finding.severity)).toEqual(["error", "warning", "warning"]);
	});

	test("reports the first text outside every landmark once", () => {
		const stray = () => node({ tag: "p", role: null, name: "9:41", focusable: false, tabIndex: -1, strayText: true });
		const landmarks = found(screen([stray(), stray()]), "landmarks");

		expect(landmarks).toHaveLength(1);
		expect(landmarks[0]!.finding.message).toContain('"9:41"');
	});
});
