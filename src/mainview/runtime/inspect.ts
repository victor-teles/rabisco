// Reads React fibers because components may not forward `data-rabisco-loc` to the DOM.
import { LINK_TO_ATTRIBUTE, LOC_ATTRIBUTE, locationOf, type Box, type DropLayout } from "../lib/render/protocol";
import {
	gapRects,
	insetBox,
	paddingRects,
	type Axis,
	type ElementLayout,
	type Insets,
	type Spacing,
} from "../lib/render/spacing";

type FiberProps = { [LOC_ATTRIBUTE]?: unknown; [LINK_TO_ATTRIBUTE]?: unknown };

export type Fiber = {
	memoizedProps: FiberProps | null;
	stateNode: unknown;
	return: Fiber | null;
	child: Fiber | null;
	sibling: Fiber | null;
};

function expandoFiber(node: Node, prefix: string): Fiber | null {
	const key = Object.keys(node).find((name) => name.startsWith(prefix));

	if (!key) return null;

	// SAFETY: `key` is one of React's own expandos (`__reactFiber$…` on rendered nodes, `__reactContainer$…`
	// on root containers), and React stores a fiber under both
	return (node as Node & Record<string, Fiber | undefined>)[key] ?? null;
}

export const fiberOf = (node: Node) => expandoFiber(node, "__reactFiber$");

function isFiberRoot(value: unknown): value is { current: Fiber } {
	return typeof value === "object" && value !== null && "current" in value && typeof value.current === "object";
}

export function rootFiber(container: Element): Fiber | null {
	const hostRoot = expandoFiber(container, "__reactContainer$");
	const current = hostRoot && isFiberRoot(hostRoot.stateNode) ? hostRoot.stateNode.current : null;

	return current ?? hostRoot;
}

const isText = (value: unknown): value is string => typeof value === "string";

export function textProp(fiber: Fiber, name: keyof FiberProps): string | null {
	const value = fiber.memoizedProps?.[name];

	return isText(value) ? value : null;
}

const locOf = (fiber: Fiber) => textProp(fiber, LOC_ATTRIBUTE);

export function hostElements(fiber: Fiber): Element[] {
	if (fiber.stateNode instanceof Element) return [fiber.stateNode];
	const found: Element[] = [];

	for (let child = fiber.child; child; child = child.sibling) found.push(...hostElements(child));

	return found;
}

function unionBox(elements: Element[]): Box | null {
	let box: { left: number; top: number; right: number; bottom: number } | null = null;

	for (const element of elements) {
		const rect = element.getBoundingClientRect();

		if (!rect.width && !rect.height) continue;
		box = box
			? {
					left: Math.min(box.left, rect.left),
					top: Math.min(box.top, rect.top),
					right: Math.max(box.right, rect.right),
					bottom: Math.max(box.bottom, rect.bottom),
				}
			: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
	}

	return box && { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top };
}

export type Located = { loc: string; elements: Element[] };

/** Hit tests box only some of the locations: walk the fibers for those alone */
function lazyLocated(loc: string, fiber: Fiber): Located {
	let elements: Element[] | null = null;

	return {
		loc,
		get elements() {
			return (elements ??= hostElements(fiber));
		},
	};
}

/** Innermost first, components included. */
export function locatedAt(x: number, y: number): Located[] {
	const target = document.elementFromPoint(x, y);

	if (!target) return [];
	const found: Located[] = [];
	const fiber = fiberOf(target);

	if (fiber) {
		for (let node: Fiber | null = fiber; node; node = node.return) {
			const loc = locOf(node);

			if (loc && found[found.length - 1]?.loc !== loc) found.push(lazyLocated(loc, node));
		}

		return found;
	}

	const selector = `[${LOC_ATTRIBUTE}]`;

	for (let element = target.closest(selector); element; element = element.parentElement?.closest(selector) ?? null) {
		found.push({ loc: element.getAttribute(LOC_ATTRIBUTE)!, elements: [element] });
	}

	return found;
}

/** One fiber per rendered instance; `null` without React fibers. */
export function instanceFibersOf(container: Element, loc: string): Fiber[] | null {
	const root = rootFiber(container);

	if (!root) return null;
	const found: Fiber[] = [];

	const visit = (fiber: Fiber) => {
		for (let node: Fiber | null = fiber; node; node = node.sibling) {
			// A component that passes the prop to its root matches twice: keep the outer one
			if (locOf(node) === loc) found.push(node);
			else if (node.child) visit(node.child);
		}
	};

	if (root.child) visit(root.child);

	return found;
}

const locSelector = (loc: string) => `[${LOC_ATTRIBUTE}="${CSS.escape(loc)}"]`;

export function instancesOf(container: Element, loc: string): Element[][] {
	const fibers = instanceFibersOf(container, loc);

	if (!fibers) return [...container.querySelectorAll(locSelector(loc))].map((element) => [element]);

	return fibers.map(hostElements);
}

export const boxesOf = (instances: Element[][]) => instances.flatMap((elements) => unionBox(elements) ?? []);

export const boxOf = (elements: Element[]) => unionBox(elements);

const contains = (box: Box, x: number, y: number) =>
	x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

type Child = { start: number; elements: Element[] };

const startOf = (loc: string, prefix: string) => Number(loc.slice(prefix.length));

/** The entry's elements nearest below the container, not descending into them. */
function childFibers(fiber: Fiber, loc: string, prefix: string): Child[] {
	const found: Child[] = [];

	const visit = (first: Fiber | null) => {
		for (let node = first; node; node = node.sibling) {
			const own = locOf(node);

			// A component that passes the prop to its root repeats the container's own location
			if (own && own !== loc && own.startsWith(prefix))
				found.push({ start: startOf(own, prefix), elements: hostElements(node) });
			else visit(node.child);
		}
	};

	visit(fiber.child);

	return found;
}

function childElements(element: Element, prefix: string): Child[] {
	const found: Child[] = [];

	for (const child of element.children) {
		const own = child.getAttribute(LOC_ATTRIBUTE);

		if (own?.startsWith(prefix)) found.push({ start: startOf(own, prefix), elements: [child] });
		else found.push(...childElements(child, prefix));
	}

	return found;
}

function gridColumns(style: CSSStyleDeclaration) {
	if (!style.display.includes("grid")) return 0;

	return style.gridTemplateColumns
		.replace(/\[[^\]]*\]/g, " ")
		.split(/\s+/)
		.filter((track) => track && track !== "none").length;
}

/** Without `version`, which the caller checks against the rendered one. */
export function dropLayoutOf(
	container: Element,
	entry: string,
	start: number,
	x: number,
	y: number,
): Omit<DropLayout, "version"> | null {
	const loc = locationOf(entry, start);
	const prefix = `${entry}:`;
	const fibers = instanceFibersOf(container, loc);

	const instances: { elements: Element[]; children: () => Child[] }[] = fibers
		? fibers.map((fiber) => ({ elements: hostElements(fiber), children: () => childFibers(fiber, loc, prefix) }))
		: [...container.querySelectorAll(locSelector(loc))].map((element) => ({
				elements: [element],
				children: () => childElements(element, prefix),
			}));

	const boxed = instances.flatMap((instance) => {
		const box = unionBox(instance.elements);

		return box ? [{ ...instance, box }] : [];
	});

	const chosen = boxed.find((instance) => contains(instance.box, x, y)) ?? boxed[0];

	if (!chosen) return null;

	const children = chosen.children().flatMap((child) => {
		const box = Number.isInteger(child.start) && child.start >= 0 ? unionBox(child.elements) : null;

		return box ? [{ start: child.start, box, first: child.elements[0] }] : [];
	});

	const own = chosen.elements[0]!;
	const first = children[0]?.first;

	// `<Card>` lays its children out in an inner element: measure the one that holds them
	const laidOut = chosen.elements.length === 1 && first && own.contains(first) ? (first.parentElement ?? own) : own;

	const style = getComputedStyle(laidOut);

	return {
		start,
		box: chosen.box,
		display: style.display,
		flexDirection: style.flexDirection,
		flexWrap: style.flexWrap,
		gridAutoFlow: style.gridAutoFlow,
		gridColumns: gridColumns(style),
		direction: style.direction,
		children: children.map((child) => ({ start: child.start, box: child.box })),
	};
}

const pixels = (value: string) => {
	const parsed = Number.parseFloat(value);

	return Number.isFinite(parsed) ? parsed : 0;
};

const insets = (style: CSSStyleDeclaration, property: "padding" | "border"): Insets => {
	const side = (name: string) =>
		pixels(style.getPropertyValue(property === "border" ? `border-${name}-width` : `padding-${name}`));

	return { top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left") };
};

/** Children out of the flow don't take part in gaps */
function flowBox(child: Element): Box | null {
	const style = getComputedStyle(child);

	if (style.position === "absolute" || style.position === "fixed" || style.display === "none") return null;
	const rect = child.getBoundingClientRect();

	return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/** Padding and gaps of an instance with one root element; `null` for fragments and components with several roots. */
export function spacingOf(elements: Element[]): Spacing | null {
	if (elements.length !== 1) return null;
	const element = elements[0]!;
	const rect = element.getBoundingClientRect();
	const box = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
	const style = getComputedStyle(element);
	const border = insets(style, "border");
	const padding = insets(style, "padding");
	const flex = style.display.includes("flex");

	if (!flex && !style.display.includes("grid")) return { padding: paddingRects(box, border, padding), gaps: [] };
	const gap = { row: pixels(style.rowGap), column: pixels(style.columnGap) };
	const children = [...element.children].flatMap((child) => flowBox(child) ?? []);
	const content = insetBox(insetBox(box, border), padding);
	const axis = flex && style.flexDirection.startsWith("column") ? "column" : "row";

	return { padding: paddingRects(box, border, padding), gaps: gapRects(content, children, gap, axis) };
}

const flexAxis = (style: CSSStyleDeclaration): Axis | null =>
	style.display.includes("flex") ? (style.flexDirection.startsWith("column") ? "column" : "row") : null;

/** Padding, gap and flow of an instance with one root element, and its parent's flex direction. */
export function layoutOf(elements: Element[]): ElementLayout | null {
	if (elements.length !== 1) return null;
	const element = elements[0]!;
	const style = getComputedStyle(element);
	const parent = element.parentElement;

	return {
		padding: insets(style, "padding"),
		gap: { row: pixels(style.rowGap), column: pixels(style.columnGap) },
		flow: style.display.includes("grid") ? "grid" : flexAxis(style),
		parent: parent ? flexAxis(getComputedStyle(parent)) : null,
	};
}
