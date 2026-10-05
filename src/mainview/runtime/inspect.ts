// Reads React fibers because components may not forward `data-rabisco-loc` to the DOM.
import { LINK_TO_ATTRIBUTE, LOC_ATTRIBUTE, type Box } from "../lib/render/protocol";

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

/** Innermost first, components included. */
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

export function instancesOf(container: Element, loc: string): Element[][] {
	const root = rootFiber(container);

	if (!root)
		return [...container.querySelectorAll(`[${LOC_ATTRIBUTE}="${CSS.escape(loc)}"]`)].map((element) => [element]);
	const found: Element[][] = [];

	const visit = (fiber: Fiber) => {
		for (let node: Fiber | null = fiber; node; node = node.sibling) {
			// A component that passes the prop to its root matches twice: keep the outer one
			if (locOf(node) === loc) found.push(hostElements(node));
			else if (node.child) visit(node.child);
		}
	};

	if (root.child) visit(root.child);

	return found;
}

export const boxesOf = (instances: Element[][]) => instances.flatMap((elements) => unionBox(elements) ?? []);

export const boxOf = (elements: Element[]) => unionBox(elements);
