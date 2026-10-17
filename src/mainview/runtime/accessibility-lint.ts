import {
	accessibilityFindings,
	CONTROL_ROLES,
	LANDMARK_ROLES,
	type AccessibleNode,
	type AccessibleRole,
} from "../../shared/design/accessibility-checks";
import type { DesignFinding } from "../../shared/design/findings";
import { LINK_TO_ATTRIBUTE } from "../lib/render/protocol";
import { ownLoc, placed, viewport } from "./design-lint";
import { fiberOf, handlesClicks } from "./inspect";
import { isScreenReaderOnly, OVERLAY_ID, SKIPPED } from "./snapshot";

const KNOWN_ROLES: ReadonlySet<string> = new Set<string>([...CONTROL_ROLES, ...LANDMARK_ROLES, "img"]);

const isKnownRole = (role: string): role is AccessibleRole => KNOWN_ROLES.has(role);

/** Content inside these is in a landmark of its own for the stray text check */
const CONTAINER_ROLES = new Set(["dialog", "alertdialog", ...LANDMARK_ROLES]);

const SECTIONING = "article, aside, main, nav, section";

const INPUT_ROLES = new Map<string, AccessibleRole | null>([
	["hidden", null],
	["checkbox", "checkbox"],
	["radio", "radio"],
	["range", "slider"],
	["number", "spinbutton"],
	["search", "searchbox"],
	["button", "button"],
	["submit", "button"],
	["reset", "button"],
	["image", "button"],
	["file", "button"],
]);

const INPUT_VALUES = new Map([
	["submit", "Submit"],
	["reset", "Reset"],
]);

/** Covers the frame: a backdrop that closes a sheet, or a screen-wide handler */
const BACKDROP_SHARE = 0.9;

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

const attribute = (element: Element, name: string) => clean(element.getAttribute(name) ?? "");

function implicitRole(element: Element): AccessibleRole | null {
	switch (element.localName) {
		case "a":
		case "area":
			return element.hasAttribute("href") ? "link" : null;
		case "button":
			return "button";
		case "input":
			return INPUT_ROLES.get((element.getAttribute("type") ?? "text").toLowerCase()) ?? "textbox";
		case "select":
			return "combobox";
		case "textarea":
			return "textbox";
		case "img":
			return element.getAttribute("alt") === "" ? null : "img";
		case "main":
			return "main";
		case "nav":
			return "navigation";
		case "aside":
			return "complementary";
		case "search":
			return "search";
		case "header":
			return element.parentElement?.closest(SECTIONING) ? null : "banner";
		case "footer":
			return element.parentElement?.closest(SECTIONING) ? null : "contentinfo";
		case "form":
		case "section":
			return element.hasAttribute("aria-label") || element.hasAttribute("aria-labelledby")
				? element.localName === "form"
					? "form"
					: "region"
				: null;
		default:
			return null;
	}
}

function roleOf(element: Element) {
	const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0] ?? null;

	return { role: explicit ? (isKnownRole(explicit) ? explicit : null) : implicitRole(element), explicit };
}

export const isHidden = (element: Element) =>
	element.getAttribute("aria-hidden") === "true" || element.hasAttribute("hidden");

/** The text a screen reader reads out of `element`: text, alt text and labels, without hidden parts */
export function contentName(element: Element): string {
	let text = "";

	for (const child of element.childNodes) {
		if (child.nodeType === Node.TEXT_NODE) text += ` ${child.textContent ?? ""}`;

		if (!(child instanceof Element) || isHidden(child) || SKIPPED.has(child.localName)) continue;

		if (getComputedStyle(child).display === "none") continue;
		const label = attribute(child, "aria-label");

		if (label) text += ` ${label}`;
		else if (child.localName === "img") text += ` ${attribute(child, "alt")}`;
		else if (child.localName === "svg") text += ` ${clean(child.querySelector("title")?.textContent ?? "")}`;
		else text += ` ${contentName(child)}`;
	}

	return clean(text);
}

const NAMED_FROM_CONTENT = new Set<AccessibleRole | null>([
	"button",
	"link",
	"tab",
	"menuitem",
	"option",
	"checkbox",
	"radio",
	"switch",
]);

function nameOf(element: Element, role: AccessibleRole | null) {
	const byIds = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).flatMap((id) => {
		const target = id ? element.ownerDocument.getElementById(id) : null;

		return target ? [contentName(target)] : [];
	});

	const named = (name: string) => ({ name, namedByPlaceholder: false });

	if (byIds.join("").trim()) return named(clean(byIds.join(" ")));
	const label = attribute(element, "aria-label");

	if (label) return named(label);

	if (element instanceof HTMLInputElement && INPUT_ROLES.get(element.type) === "button")
		return named(
			clean(element.type === "image" ? element.alt : element.value || (INPUT_VALUES.get(element.type) ?? "")),
		);

	const labels = "labels" in element && element.labels instanceof NodeList ? [...element.labels] : [];

	const fromLabels = clean(
		labels.map((labelElement) => (labelElement instanceof Element ? contentName(labelElement) : "")).join(" "),
	);

	if (fromLabels) return named(fromLabels);

	if (element.localName === "img") return named(attribute(element, "alt"));

	if (element.localName === "svg") return named(clean(element.querySelector("title")?.textContent ?? ""));

	if (NAMED_FROM_CONTENT.has(role)) {
		const content = contentName(element);

		if (content) return named(content);
	}

	const title = attribute(element, "title");

	if (title) return named(title);
	const placeholder = attribute(element, "placeholder");

	return { name: placeholder, namedByPlaceholder: !!placeholder };
}

const NATIVE_FOCUSABLE =
	"a[href], area[href], button, input:not([type='hidden']), select, textarea, summary, iframe, [contenteditable='true'], [contenteditable='']";

const FOCUSABLE = `${NATIVE_FOCUSABLE}, [tabindex]:not([tabindex^='-'])`;

function isDisabled(element: Element) {
	return element.matches(":disabled") || element.getAttribute("aria-disabled") === "true";
}

function tabIndexOf(element: Element) {
	const value = Number.parseInt(element.getAttribute("tabindex") ?? "", 10);

	if (Number.isFinite(value)) return value;

	return element.matches(NATIVE_FOCUSABLE) ? 0 : -1;
}

function ownText(element: Element) {
	let text = "";

	for (const node of element.childNodes) if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";

	return clean(text);
}

function clicks(element: Element) {
	if (element.hasAttribute(LINK_TO_ATTRIBUTE)) return true;
	const fiber = fiberOf(element);

	return !!fiber && handlesClicks(fiber);
}

type Walk = { inLandmark: boolean; frameArea: number };

function visit(element: Element, walk: Walk, nodes: AccessibleNode[]) {
	if (SKIPPED.has(element.localName) || element.id === OVERLAY_ID || isHidden(element) || element.hasAttribute("inert"))
		return;
	const style = getComputedStyle(element);

	if (style.display === "none" || style.visibility === "hidden" || Number.parseFloat(style.opacity) === 0) return;
	const rect = element.getBoundingClientRect();
	const screenReaderOnly = isScreenReaderOnly(style, rect);
	const { role, explicit } = roleOf(element);
	const tabIndex = tabIndexOf(element);
	const disabled = isDisabled(element);
	const focusable = tabIndex >= 0 && !disabled;
	const text = ownText(element);

	const clickOnly =
		!focusable &&
		!disabled &&
		element.localName !== "label" &&
		clicks(element) &&
		rect.width * rect.height < walk.frameArea * BACKDROP_SHARE;

	const strayText = !walk.inLandmark && !screenReaderOnly && text !== "";

	if (role || clickOnly || strayText || (focusable && element instanceof HTMLElement)) {
		const { name, namedByPlaceholder } = nameOf(element, role);
		const parentText = element.parentElement ? ownText(element.parentElement) : "";

		nodes.push({
			loc: ownLoc(element),
			tag: element.localName,
			role,
			name: name || (role ? "" : text),
			namedByPlaceholder,
			box: screenReaderOnly
				? { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: 0, height: 0 }
				: { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height },
			focusable,
			tabIndex,
			disabled,
			clickOnly,
			hasFocusableInside: clickOnly && element.querySelector(FOCUSABLE) !== null,
			inline: role === "link" && style.display === "inline" && parentText !== "",
			labelled: "labels" in element && element.labels instanceof NodeList && element.labels.length > 0,
			strayText,
		});
	}

	const inner: Walk = {
		...walk,
		inLandmark: walk.inLandmark || CONTAINER_ROLES.has(role ?? explicit ?? ""),
	};

	for (const child of element.children) visit(child, inner, nodes);
}

/** Call after `settle()`. `touch` holds phones and tablets to the 44px touch size */
export function lintAccessibility(container: Element, touch: boolean): DesignFinding[] {
	const frame = viewport();
	const nodes: AccessibleNode[] = [];

	for (const child of container.children)
		visit(child, { inLandmark: false, frameArea: frame.width * frame.height }, nodes);

	return placed(accessibilityFindings({ nodes, frame, touch }));
}
