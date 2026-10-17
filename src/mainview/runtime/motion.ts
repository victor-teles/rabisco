// Plays an element's motion again on the canvas, where the pointer never reaches the screen (decision 0027).
// Animations restart. Hover and press copy the declarations of the screen's `:hover` and `:active` rules that match
// the element into its inline style for a moment, so its `transition` plays there and back.

import type { MotionKind } from "../../shared/motion/presets";

const HOLD_MS = 700;

const EXIT_TIMEOUT_MS = 2000;

const hasStyle = (element: Element): element is HTMLElement | SVGElement =>
	element instanceof HTMLElement || element instanceof SVGElement;

/** `a:hover, b` split on top-level commas */
function selectors(text: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let last = 0;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];

		if (ch === "\\") i++;
		else if (ch === "(" || ch === "[") depth++;
		else if (ch === ")" || ch === "]") depth--;
		else if (ch === "," && depth === 0) {
			parts.push(text.slice(last, i));
			last = i + 1;
		}
	}

	return [...parts, text.slice(last)];
}

function matchesWithout(element: Element, selector: string, pseudo: string): boolean {
	if (!selector.includes(pseudo)) return false;

	try {
		return element.matches(selector.split(pseudo).join(""));
	} catch {
		return false;
	}
}

/** The declarations the element would get in that state, in stylesheet order */
export function stateDeclarations(element: Element, pseudo: ":hover" | ":active"): [string, string][] {
	const found: [string, string][] = [];

	const visit = (rules: CSSRuleList) => {
		for (const rule of rules) {
			if (rule instanceof CSSStyleRule) {
				if (selectors(rule.selectorText).some((selector) => matchesWithout(element, selector, pseudo))) {
					for (const property of rule.style) found.push([property, rule.style.getPropertyValue(property)]);
				}

				if (rule.cssRules.length) visit(rule.cssRules);
			} else if (rule instanceof CSSMediaRule) {
				if (matchMedia(rule.conditionText).matches) visit(rule.cssRules);
			} else if (rule instanceof CSSSupportsRule) {
				if (CSS.supports(rule.conditionText)) visit(rule.cssRules);
			} else if (rule instanceof CSSLayerBlockRule) visit(rule.cssRules);
		}
	};

	for (const sheet of document.styleSheets) {
		try {
			visit(sheet.cssRules);
		} catch {
			// A sheet from another origin can't be read
		}
	}

	return found;
}

/** Restores what `hold` set, unless something else changed the property since */
function hold(element: HTMLElement | SVGElement, declarations: [string, string][]) {
	const { style } = element;

	const saved = declarations.map(([property, value]) => {
		const before = { property, value: style.getPropertyValue(property), priority: style.getPropertyPriority(property) };
		style.setProperty(property, value);

		return { ...before, set: style.getPropertyValue(property) };
	});

	setTimeout(() => {
		for (const { property, value, priority, set } of saved.reverse()) {
			if (style.getPropertyValue(property) !== set) continue;

			if (value) style.setProperty(property, value, priority);
			else style.removeProperty(property);
		}
	}, HOLD_MS);
}

function restart(element: Element) {
	for (const animation of element.getAnimations()) {
		animation.cancel();
		animation.play();
	}
}

/** Closes the element for one exit animation, then puts its `data-state` back */
function playExit(element: Element) {
	const before = element.getAttribute("data-state");
	element.setAttribute("data-state", "closed");

	const animations = element.getAnimations();
	const done = Promise.all(animations.map((animation) => animation.finished.catch(() => null)));
	const timeout = new Promise((resolve) => setTimeout(resolve, EXIT_TIMEOUT_MS));

	void Promise.race([done, timeout]).then(() => {
		if (element.getAttribute("data-state") !== "closed") return;

		if (before === null) element.removeAttribute("data-state");
		else element.setAttribute("data-state", before);
	});
}

export function replayMotion(elements: Element[], kind: MotionKind) {
	for (const element of elements) {
		if (kind === "hover" || kind === "press") {
			const declarations = stateDeclarations(element, kind === "hover" ? ":hover" : ":active");

			if (declarations.length && hasStyle(element)) hold(element, declarations);
		} else if (kind === "exit") playExit(element);
		else restart(element);
	}
}
