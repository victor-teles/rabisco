import type {
	BarPlacement,
	BarSample,
	ControlFill,
	ControlSample,
	SamplePlace,
	ScreenSample,
} from "../../shared/design/consistency-checks";
import { contentName, isHidden } from "./accessibility-lint";
import { located, ownLoc, viewport } from "./design-lint";
import { color, isScreenReaderOnly, OVERLAY_ID, SKIPPED } from "./snapshot";

const BUTTONS = "button, [role='button'], input[type='submit'], input[type='button']";

const TEXT_INPUT_TYPES = new Set(["text", "email", "password", "search", "tel", "url", "number", "date", "time"]);

const NAVS = "nav, [role='navigation']";

/** Content in these is navigation or chrome, not the page's own column */
const CHROME = "nav, [role='navigation'], [role='tablist'], [role='menu'], header, footer, aside";

const ITEMS = "a[href], button, [role='tab'], [role='link'], [role='menuitem'], [data-link-to]";

/** A bar this tall and narrow is a side nav */
const SIDE_HEIGHT_SHARE = 0.5;

const SIDE_WIDTH_SHARE = 0.4;

const EDGE_PX = 2;

/** A bar starting this close to the top is a top bar, below a status bar or a notch */
const TOP_PX = 120;

const MIN_FILL_ALPHA = 0.5;

const IN_FLOW = new Set(["static", "relative", "sticky"]);

const px = (value: string) => Number.parseFloat(value) || 0;

function placeOf(element: Element): SamplePlace {
	const at = located(ownLoc(element));

	return at ? { path: at.path, start: at.start } : {};
}

function isShown(element: Element) {
	if (SKIPPED.has(element.localName) || element.id === OVERLAY_ID || isHidden(element)) return false;

	for (let current: Element | null = element; current; current = current.parentElement) {
		if (isHidden(current)) return false;
	}

	const style = getComputedStyle(element);

	return (
		style.display !== "none" &&
		style.visibility !== "hidden" &&
		px(style.opacity) > 0 &&
		!isScreenReaderOnly(style, element.getBoundingClientRect())
	);
}

function fillOf(style: CSSStyleDeclaration): ControlFill {
	const background = color(style.backgroundColor);

	if (background && background.a >= MIN_FILL_ALPHA) return "filled";

	return px(style.borderTopWidth) > 0 && style.borderTopStyle !== "none" ? "outline" : "plain";
}

function controlOf(element: Element, kind: ControlSample["kind"]): ControlSample | null {
	if (!isShown(element) || element.closest(CHROME)) return null;
	const rect = element.getBoundingClientRect();

	if (rect.width <= 0 || rect.height <= 0) return null;

	const text =
		kind === "button" ? contentName(element) || (element instanceof HTMLInputElement ? element.value : "") : "";

	if (kind === "button" && !text) return null;
	const style = getComputedStyle(element);

	return {
		...placeOf(element),
		kind,
		fill: fillOf(style),
		text,
		height: rect.height,
		radius: px(style.borderTopLeftRadius),
		fontSize: px(style.fontSize),
		slot: element.getAttribute("data-slot"),
	};
}

function placementOf(rect: DOMRect, frame: { width: number; height: number }, page: number): BarPlacement {
	const top = rect.top + window.scrollY;

	if (rect.height >= frame.height * SIDE_HEIGHT_SHARE && rect.width <= frame.width * SIDE_WIDTH_SHARE)
		return rect.left + rect.width / 2 < frame.width / 2 ? "left" : "right";

	if (top <= TOP_PX) return "top";

	return top + rect.height >= page - EDGE_PX ? "bottom" : "inline";
}

const labelOf = (item: Element) => item.getAttribute("aria-label")?.trim() || contentName(item);

/** Its links and buttons, or in a prototype that draws tabs as plain boxes, the boxes of its first row with several */
function itemsOf(bar: Element) {
	const items: string[] = [];

	for (const item of bar.querySelectorAll(ITEMS)) {
		if (item.parentElement?.closest(ITEMS) || !isShown(item)) continue;
		const label = labelOf(item);

		if (label) items.push(label);
	}

	if (items.length) return items;
	let row = bar;

	while (row.children.length === 1) row = row.children[0]!;

	for (const child of row.children) {
		const label = isShown(child) ? labelOf(child) : "";

		if (label) items.push(label);
	}

	return items;
}

function barOf(element: Element, kind: BarSample["kind"], frame: { width: number; height: number }): BarSample | null {
	if (!isShown(element)) return null;
	const rect = element.getBoundingClientRect();

	if (rect.width <= 0 || rect.height <= 0) return null;
	const placement = placementOf(rect, frame, document.documentElement.scrollHeight);
	const items = itemsOf(element);

	return {
		...placeOf(element),
		kind,
		placement,
		size: placement === "left" || placement === "right" ? rect.width : rect.height,
		items,
	};
}

/** The left edge of the page's own column: where its leftmost text in the flow starts */
function insetOf(container: Element, frame: { width: number }) {
	let inset: number | null = null;

	for (const element of container.querySelectorAll("*")) {
		if (element.closest(CHROME)) continue;

		const hasText = [...element.childNodes].some(
			(node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
		);

		if (!hasText || !isShown(element) || !IN_FLOW.has(getComputedStyle(element).position)) continue;
		const x = Math.round(element.getBoundingClientRect().left + window.scrollX);

		if (x >= 0 && x < frame.width / 2 && (inset === null || x < inset)) inset = x;
	}

	return inset;
}

/** Call after `settle()`. What the consistency check compares across screens */
export function sampleScreen(container: Element): ScreenSample {
	const frame = viewport();
	const controls: ControlSample[] = [];
	const bars: BarSample[] = [];

	for (const element of container.querySelectorAll(BUTTONS)) {
		const control = controlOf(element, "button");

		if (control) controls.push(control);
	}

	for (const element of container.querySelectorAll("input")) {
		if (!TEXT_INPUT_TYPES.has(element.type)) continue;
		const control = controlOf(element, "input");

		if (control) controls.push(control);
	}

	for (const element of container.querySelectorAll(NAVS)) {
		if (element.parentElement?.closest(NAVS)) continue;
		const bar = barOf(element, "nav", frame);

		if (bar) bars.push(bar);
	}

	for (const element of container.querySelectorAll("header")) {
		if (element.parentElement?.closest("article, aside, nav, section, header")) continue;
		const bar = barOf(element, "header", frame);

		if (bar) bars.push(bar);
	}

	return { width: frame.width, inset: insetOf(container, frame), controls, bars };
}
