import { childElements, findElement, parseJsx, type JsxElement } from "../../shared/jsx";

/** An element the canvas can select; fragments have no box or props of their own, so they're skipped */
export type Crumb = { start: number; name: string; component: boolean };

const crumbOf = (element: JsxElement & { name: string }): Crumb => ({
	start: element.start,
	name: element.name,
	component: !element.intrinsic,
});

const named = (element: JsxElement): element is JsxElement & { name: string } => element.name !== null;

/** Children through fragments, in source order */
export function selectableChildren(element: JsxElement): JsxElement[] {
	return childElements(element).flatMap((child) => (named(child) ? [child] : selectableChildren(child)));
}

export function selectableParent(element: JsxElement): (JsxElement & { name: string }) | null {
	let parent = element.parent;

	while (parent && !named(parent)) parent = parent.parent;

	return parent && named(parent) ? parent : null;
}

/** Outermost first, without the element itself */
export function ancestorsOf(source: string, start: number): Crumb[] {
	const element = findElement(parseJsx(source), start);
	const crumbs: Crumb[] = [];

	for (let parent = element && selectableParent(element); parent; parent = selectableParent(parent))
		crumbs.unshift(crumbOf(parent));

	return crumbs;
}

/** The next (`1`) or previous (`-1`) sibling, wrapping around as Figma's Tab does; `null` for an only child */
export function siblingStart(source: string, start: number, step: 1 | -1): number | null {
	const element = findElement(parseJsx(source), start);
	const parent = element && selectableParent(element);

	if (!element || !parent) return null;
	const siblings = selectableChildren(parent);
	const index = siblings.indexOf(element);

	if (index === -1 || siblings.length < 2) return null;

	return siblings[(index + step + siblings.length) % siblings.length]!.start;
}
