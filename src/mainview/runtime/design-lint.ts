// Reads the rendered screen into plain `LayoutNode`s; the checks themselves live in `shared/design/layout-checks`.
import type { DesignFinding } from "../../shared/design/findings";
import { layoutFindings, type LayoutNode } from "../../shared/design/layout-checks";
import { LOC_ATTRIBUTE } from "../lib/render/protocol";
import { fiberOf, textProp } from "./inspect";
import { color, isScreenReaderOnly, OVERLAY_ID, SKIPPED } from "./snapshot";

const SIDES = ["top", "right", "bottom", "left"];

const SCROLL_X_CLASS = /(?:^|[\s:])overflow-(?:x-)?(?:auto|scroll)(?:\s|$)/;

/** Components may not forward the attribute, so the fibers between the element and its parent are read too. */
function ownLoc(element: Element): string | null {
	const own = fiberOf(element);

	for (let fiber = own; fiber; fiber = fiber.return) {
		if (fiber !== own && fiber.stateNode instanceof Element) return null;
		const loc = textProp(fiber, LOC_ATTRIBUTE);

		if (loc) return loc;
	}

	return element.getAttribute(LOC_ATTRIBUTE);
}

function ownText(element: Element) {
	let text = "";

	for (const node of element.childNodes) if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";

	return text.replace(/\s+/g, " ").trim();
}

/** CSS computes `overflow-x: auto` when only Y scrolls; the class or inline style says what the author meant */
function scrollsX(element: Element, style: CSSStyleDeclaration) {
	if (style.overflowX !== "auto" && style.overflowX !== "scroll") return false;
	const inline = element instanceof HTMLElement ? element.style.overflowX || element.style.overflow : "";

	return /auto|scroll/.test(inline) || SCROLL_X_CLASS.test(element.getAttribute("class") ?? "");
}

const px = (value: string) => Number.parseFloat(value) || 0;

const hasBorder = (style: CSSStyleDeclaration) =>
	SIDES.some(
		(side) =>
			px(style.getPropertyValue(`border-${side}-width`)) > 0 &&
			style.getPropertyValue(`border-${side}-style`) !== "none",
	);

const hasNegativeMargin = (style: CSSStyleDeclaration) =>
	SIDES.some((side) => px(style.getPropertyValue(`margin-${side}`)) < 0);

const hasTransform = (style: CSSStyleDeclaration) =>
	[style.transform, style.translate, style.rotate, style.scale].some((value) => !!value && value !== "none");

function lineClamp(style: CSSStyleDeclaration) {
	const clamp = Number.parseInt(style.getPropertyValue("-webkit-line-clamp"), 10);

	return Number.isFinite(clamp) && clamp > 0 ? clamp : null;
}

/** `inherited` is the parent's location, for elements no JSX of the project renders directly (shadcn internals). */
function nodeOf(element: Element, inherited: string | null): LayoutNode | null {
	if (SKIPPED.has(element.localName) || element.id === OVERLAY_ID) return null;
	const style = getComputedStyle(element);
	const opacity = px(style.opacity);

	if (style.display === "none" || opacity <= 0) return null;
	const rect = element.getBoundingClientRect();

	if (isScreenReaderOnly(style, rect)) return null;
	const loc = ownLoc(element) ?? inherited;
	const children: LayoutNode[] = [];

	// Icons: their shapes are not layout
	if (!(element instanceof SVGElement)) {
		for (const child of element.children) {
			const node = nodeOf(child, loc);

			if (node) children.push(node);
		}
	}

	return {
		loc,
		tag: element.localName,
		box: { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height },
		scrollWidth: element.scrollWidth,
		scrollHeight: element.scrollHeight,
		clientWidth: element.clientWidth,
		clientHeight: element.clientHeight,
		overflowX: style.overflowX,
		overflowY: style.overflowY,
		scrollsX: scrollsX(element, style),
		textOverflow: style.textOverflow,
		lineClamp: lineClamp(style),
		position: style.position,
		display: style.display,
		hasNegativeMargin: hasNegativeMargin(style),
		hasTransform: hasTransform(style),
		color: color(style.color),
		background: color(style.backgroundColor),
		hasBackgroundImage: style.backgroundImage !== "none",
		opacity,
		fontSize: px(style.fontSize),
		fontWeight: px(style.fontWeight),
		ownText: style.visibility === "visible" ? ownText(element) : "",
		hasBorder: hasBorder(style),
		children,
	};
}

/** `loc` is `path:start`, and a path may hold a colon */
function located(loc: string | null): { path: string; start: number } | null {
	const colon = loc?.lastIndexOf(":") ?? -1;

	if (!loc || colon < 1) return null;
	const start = Number(loc.slice(colon + 1));

	return Number.isInteger(start) && start >= 0 ? { path: loc.slice(0, colon), start } : null;
}

/** Call after `settle()`, so images and fonts have their final size. */
export function lintScreen(container: Element): DesignFinding[] {
	const root = nodeOf(container, null);

	if (!root) return [];
	const frame = { width: document.documentElement.clientWidth, height: window.innerHeight };

	return layoutFindings(root, frame).map(({ loc, finding }) => {
		const at = located(loc);

		return at ? { ...finding, path: at.path, start: at.start } : finding;
	});
}
