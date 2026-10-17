import { Findings, type LayoutBox, type LayoutFinding } from "./layout-checks";

/** Roles a person operates; each needs a name and a target to hit */
export const CONTROL_ROLES = [
	"button",
	"link",
	"textbox",
	"searchbox",
	"combobox",
	"checkbox",
	"radio",
	"switch",
	"slider",
	"spinbutton",
	"tab",
	"menuitem",
	"option",
] as const;

export const LANDMARK_ROLES = [
	"main",
	"navigation",
	"banner",
	"contentinfo",
	"complementary",
	"region",
	"form",
	"search",
] as const;

export type AccessibleRole = (typeof CONTROL_ROLES)[number] | (typeof LANDMARK_ROLES)[number] | "img";

/** What the frame reads from one element that matters to a screen reader or a keyboard, in DOM order. */
export type AccessibleNode = {
	loc: string | null;
	tag: string;
	/** `null` for elements that are only in the list because they react to clicks, or hold text */
	role: AccessibleRole | null;
	/** The computed accessible name, trimmed */
	name: string;
	/** The name comes from `placeholder` alone, which goes away on typing */
	namedByPlaceholder: boolean;
	box: LayoutBox;
	/** In the Tab sequence */
	focusable: boolean;
	tabIndex: number;
	disabled: boolean;
	/** Has an `onClick` or a prototype link but isn't a control and can't take focus */
	clickOnly: boolean;
	/** Holds something focusable, so the keyboard can reach what it does */
	hasFocusableInside: boolean;
	/** A link inside a sentence, which WCAG leaves out of the target size rule */
	inline: boolean;
	/** A `<label>` points at it, so the label is part of its target */
	labelled: boolean;
	/** Has text of its own outside any landmark */
	strayText: boolean;
};

export type AccessibleScreen = {
	nodes: AccessibleNode[];
	frame: { width: number; height: number };
	/** Phones and tablets, where 44px is the touch size platforms ask for */
	touch: boolean;
};

/** WCAG 2.2 AA, target size (minimum) */
const MIN_TARGET_PX = 24;

/** Apple's Human Interface Guidelines; Material asks for 48dp */
const TOUCH_TARGET_PX = 44;

/** Sub-pixel rounding makes boxes off by a fraction */
const TOLERANCE_PX = 1;

/** A Tab that goes up this far, in the same column, reads as going back */
const BACKWARD_PX = 8;

const MAX_FOCUS_JUMPS = 3;

const NAMED_FROM_CONTENT: ReadonlySet<AccessibleRole | null> = new Set<AccessibleRole>([
	"button",
	"link",
	"tab",
	"menuitem",
	"option",
]);

const CONTROLS: ReadonlySet<AccessibleRole | null> = new Set<AccessibleRole>(CONTROL_ROLES);

const quote = (text: string) => (text.length > 40 ? `"${text.slice(0, 39)}…"` : `"${text}"`);

const describe = (node: AccessibleNode) => (node.name ? `<${node.tag}> ${quote(node.name)}` : `<${node.tag}>`);

const size = (box: LayoutBox) => `${Math.round(box.width)}×${Math.round(box.height)}px`;

function checkLabel(node: AccessibleNode, findings: Findings) {
	if (node.role === "img") {
		if (!node.name)
			findings.add(
				node,
				"label",
				"error",
				`<${node.tag}> has no alt text. Describe the image, or write alt="" when it is decoration`,
			);

		return;
	}

	if (!CONTROLS.has(node.role)) return;

	if (!node.name) {
		const how = NAMED_FROM_CONTENT.has(node.role)
			? "Give it text, or an aria-label when it shows only an icon"
			: "Pair it with a <Label>, or give it an aria-label";

		findings.add(
			node,
			"label",
			"error",
			`<${node.tag}>${node.role === node.tag ? "" : ` (${node.role})`} has no label, so a screen reader says only its role. ${how}`,
		);
	} else if (node.namedByPlaceholder)
		findings.add(
			node,
			"label",
			"warning",
			`<${node.tag}> ${quote(node.name)} is labelled only by its placeholder, which goes away on typing. Add a <Label>`,
		);
}

const overlapsX = (a: LayoutBox, b: LayoutBox) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0;

function checkFocusOrder(nodes: AccessibleNode[], findings: Findings) {
	for (const node of nodes) {
		if (node.clickOnly && !node.hasFocusableInside)
			findings.add(
				node,
				"focus-order",
				"error",
				`${describe(node)} reacts to clicks but Tab can't reach it. Make it a <button>, or a link when it goes to another screen`,
			);

		if (node.focusable && node.tabIndex > 0)
			findings.add(
				node,
				"focus-order",
				"warning",
				`${describe(node)} has tabIndex={${node.tabIndex}}, which moves it ahead of everything else. Use 0 and let the order follow the page`,
			);
	}

	const sequence = nodes.filter((node) => node.focusable && node.tabIndex === 0 && node.box.width > 0);
	let jumps = 0;

	for (let i = 1; i < sequence.length && jumps < MAX_FOCUS_JUMPS; i++) {
		const previous = sequence[i - 1]!;
		const next = sequence[i]!;

		if (next.box.y + next.box.height < previous.box.y - BACKWARD_PX && overlapsX(previous.box, next.box)) {
			jumps++;
			findings.add(
				next,
				"focus-order",
				"warning",
				`Tab goes from ${describe(previous)} up to ${describe(next)}, which sits above it. Put it earlier in the code so focus moves down the page`,
			);
		}
	}
}

function checkTapTarget(node: AccessibleNode, touch: boolean, findings: Findings) {
	if (!CONTROLS.has(node.role) || node.disabled || node.inline || node.labelled) return;
	const { width, height } = node.box;

	if (width <= 0 || height <= 0) return;
	const smallest = Math.min(width, height) + TOLERANCE_PX;

	if (smallest < MIN_TARGET_PX)
		findings.add(
			node,
			"tap-target",
			"error",
			`${describe(node)} is ${size(node.box)}. Make it at least ${MIN_TARGET_PX}×${MIN_TARGET_PX}px, for example with size-6 or padding`,
		);
	else if (touch && smallest < TOUCH_TARGET_PX)
		findings.add(
			node,
			"tap-target",
			"warning",
			`${describe(node)} is ${size(node.box)}, under the ${TOUCH_TARGET_PX}×${TOUCH_TARGET_PX}px a finger needs on a phone`,
		);
}

function checkLandmarks(nodes: AccessibleNode[], findings: Findings) {
	const root = { loc: null };
	const mains = nodes.filter((node) => node.role === "main");

	if (!mains.length)
		findings.add(
			root,
			"landmarks",
			"warning",
			"The screen has no <main>. Wrap its content in <main> so a screen reader can jump to it",
		);
	else if (mains.length > 1)
		for (const extra of mains.slice(1))
			findings.add(extra, "landmarks", "error", `The screen has ${mains.length} <main> landmarks. Keep one`);

	const navs = nodes.filter((node) => node.role === "navigation");

	if (navs.length > 1)
		for (const nav of navs)
			if (!nav.name)
				findings.add(
					nav,
					"landmarks",
					"warning",
					`The screen has ${navs.length} <nav>s. Give each an aria-label, such as "Main" or "Tabs", to tell them apart`,
				);

	if (!mains.length) return;
	const stray = nodes.find((node) => node.strayText);

	if (stray)
		findings.add(
			stray,
			"landmarks",
			"warning",
			`${describe(stray)} is outside every landmark, so jumping by landmark skips it. Move it into <main>, <header>, <nav> or <footer>`,
			1,
		);
}

/** Accessibility checks on a rendered screen: labels, focus order, tap targets and landmarks. */
export function accessibilityFindings(screen: AccessibleScreen): LayoutFinding[] {
	const findings = new Findings();

	for (const node of screen.nodes) {
		checkLabel(node, findings);
		checkTapTarget(node, screen.touch, findings);
	}

	checkFocusOrder(screen.nodes, findings);
	checkLandmarks(screen.nodes, findings);

	return findings.list;
}
