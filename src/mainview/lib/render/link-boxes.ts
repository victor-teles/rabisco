import type { Box, LinkBox } from "./protocol";

export type LinkBoxes = { version: string; width: number; boxes: ReadonlyMap<number, Box> };

let current: ReadonlyMap<string, LinkBoxes> = new Map();

const listeners = new Set<() => void>();

export function subscribeLinkBoxes(listener: () => void) {
	listeners.add(listener);

	return () => void listeners.delete(listener);
}

export const linkBoxes = () => current;

const sameBox = (a: Box | undefined, b: Box) =>
	!!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function sameLinks(known: LinkBoxes | undefined, version: string, width: number, links: readonly LinkBox[]) {
	if (!known || known.version !== version || known.width !== width || known.boxes.size !== links.length) return false;

	return links.every((link) => sameBox(known.boxes.get(link.start), link.box));
}

export function setLinkBoxes(entry: string, version: string, width: number, links: readonly LinkBox[]) {
	if (sameLinks(current.get(entry), version, width, links)) return;
	const boxes = new Map(links.map((link) => [link.start, link.box]));
	current = new Map(current).set(entry, { version, width, boxes });

	for (const listener of listeners) listener();
}
