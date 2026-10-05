/**
 * Maps the rendered screen back to its source through React's fiber tree.
 * Every element carries a `data-rabisco-loc` prop (see `injectLocations`):
 * DOM elements as an attribute, component elements as a prop that only the
 * fiber keeps when the component doesn't pass it on. Falls back to the DOM
 * attributes when React's internals aren't there.
 */
import { LINK_TO_ATTRIBUTE, LOC_ATTRIBUTE, type Box } from "../lib/render/protocol";

/** The props of a fiber this runtime reads; screens may pass anything, so values are checked on read. */
type FiberProps = { [LOC_ATTRIBUTE]?: unknown; [LINK_TO_ATTRIBUTE]?: unknown };

/** The fields of a React fiber this module reads. */
export type Fiber = {
	memoizedProps: FiberProps | null;
	stateNode: unknown;
	return: Fiber | null;
	child: Fiber | null;
	sibling: Fiber | null;
};

/** The fiber React keeps on a node it manages, under a randomized `prefix…` expando key. */
function expandoFiber(node: Node, prefix: string): Fiber | null {
	const key = Object.keys(node).find((name) => name.startsWith(prefix));

	if (!key) return null;

	// SAFETY: `key` is one of React's own expandos (`__reactFiber$…` on rendered nodes, `__reactContainer$…`
	// on root containers), and React stores a fiber under both
	return (node as Node & Record<string, Fiber | undefined>)[key] ?? null;
}

export const fiberOf = (node: Node) => expandoFiber(node, "__reactFiber$");

/** A HostRoot's `stateNode`: the FiberRoot, whose `current` is the committed tree. */
function isFiberRoot(value: unknown): value is { current: Fiber } {
	return typeof value === "object" && value !== null && "current" in value && typeof value.current === "object";
}

/** The current tree under a React root container (its HostRoot's committed fiber). */
export function rootFiber(container: Element): Fiber | null {
	const hostRoot = expandoFiber(container, "__reactContainer$");
	const current = hostRoot && isFiberRoot(hostRoot.stateNode) ? hostRoot.stateNode.current : null;

	return current ?? hostRoot;
}

const isText = (value: unknown): value is string => typeof value === "string";

/** A text prop of `fiber`; `null` when it is missing or not text. */
export function textProp(fiber: Fiber, name: keyof FiberProps): string | null {
	const value = fiber.memoizedProps?.[name];

	return isText(value) ? value : null;
}

const locOf = (fiber: Fiber) => textProp(fiber, LOC_ATTRIBUTE);

/** A fiber's outermost DOM elements: itself when it is one, else the first ones below it. */
export function hostElements(fiber: Fiber): Element[] {
	if (fiber.stateNode instanceof Element) return [fiber.stateNode];
	const found: Element[] = [];

	for (let child = fiber.child; child; child = child.sibling) found.push(...hostElements(child));

	return found;
}

/** The union of `elements`' boxes, in frame CSS pixels; `null` when nothing has a size. */
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

/** One rendered source element: its `data-rabisco-loc` value and its outermost DOM elements. */
export type Located = { loc: string; elements: Element[] };

/**
 * The located elements at `x`, `y`: the one under the point, then its
 * ancestors, innermost first, components included. A component that passes
 * the prop on to its root shows up once.
 */
export function locatedAt(x: number, y: number): Located[] {
	const target = document.elementFromPoint(x, y);

	if (!target) return [];
	const found: Located[] = [];
	const fiber = fiberOf(target);

	if (fiber) {
		for (let node: Fiber | null = fiber; node; node = node.return) {
			const loc = locOf(node);

			if (loc && found[found.length - 1]?.loc !== loc) found.push({ loc, elements: hostElements(node) });
		}

		return found;
	}

	const selector = `[${LOC_ATTRIBUTE}]`;

	for (let element = target.closest(selector); element; element = element.parentElement?.closest(selector) ?? null) {
		found.push({ loc: element.getAttribute(LOC_ATTRIBUTE)!, elements: [element] });
	}

	return found;
}

/** Every rendered instance of the source element `loc` (more than one inside a `.map`). */
export function instancesOf(container: Element, loc: string): Element[][] {
	const root = rootFiber(container);

	if (!root)
		return [...container.querySelectorAll(`[${LOC_ATTRIBUTE}="${CSS.escape(loc)}"]`)].map((element) => [element]);
	const found: Element[][] = [];

	const visit = (fiber: Fiber) => {
		// Iterative over siblings, recursive over depth: screens are shallow enough
		for (let node: Fiber | null = fiber; node; node = node.sibling) {
			// A component that passes the prop to its root matches twice: keep the outer one
			if (locOf(node) === loc) found.push(hostElements(node));
			else if (node.child) visit(node.child);
		}
	};

	if (root.child) visit(root.child);

	return found;
}

/** The boxes of `instances`, skipping the ones with no size. */
export const boxesOf = (instances: Element[][]) => instances.flatMap((elements) => unionBox(elements) ?? []);

export const boxOf = (elements: Element[]) => unionBox(elements);
