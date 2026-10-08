// Several selected elements, all in one screen file: the first start is the primary one, which the
// inspector's single-element views and the element menu's one-element actions act on.

import { childSlots, findElement, parseJsx, type JsxElement } from "../../shared/jsx";
import { attrValue, dedent, indentAt, indentUnit, reindent, startsLine } from "../../shared/jsx/text";
import { classNameOf, setClassName } from "../../shared/tailwind/classes";

export type Edited = { source: string; start: number };

/** A `null` start is an element the edit refused */
export type EditedEach = { source: string; starts: (number | null)[] };

/** ⇧-click: removes a selected start, else adds it last. Removing the primary makes the next one primary */
export function toggleStart(starts: readonly number[], start: number): number[] {
	return starts.includes(start) ? starts.filter((s) => s !== start) : [...starts, start];
}

/** Drops elements inside another selected one: deleting or copying the outer one takes them along */
export function outermost(source: string, starts: readonly number[]): number[] {
	const tree = parseJsx(source);
	const found = [...new Set(starts)].flatMap((start) => findElement(tree, start) ?? []);

	return found.flatMap((element) =>
		found.some((other) => other !== element && other.start <= element.start && element.end <= other.end)
			? []
			: [element.start],
	);
}

/**
 * Edits from the last offset to the first, so every offset is still valid when its turn comes. An edit only changes
 * text at or after its element's start, so it moves the results of the edits before it by what it added.
 */
export function editEach(
	source: string,
	starts: readonly number[],
	edit: (source: string, start: number) => Edited | null,
): EditedEach {
	const order = starts.map((start, index) => ({ start, index })).sort((a, b) => b.start - a.start);
	const results: (number | null)[] = starts.map(() => null);
	let current = source;

	for (const { start, index } of order) {
		const edited = edit(current, start);

		if (!edited) continue;
		const delta = edited.source.length - current.length;

		for (let i = 0; i < results.length; i++) {
			const result = results[i];

			if (result !== null && result !== undefined && result > start) results[i] = result + delta;
		}

		results[index] = edited.start;
		current = edited.source;
	}

	return { source: current, starts: results };
}

/** An edit for `editEach` that rewrites the element's classes; `null` for a computed className */
export const restyle =
	(change: (classes: string) => string) =>
	(source: string, start: number): Edited | null => {
		const element = findElement(parseJsx(source), start);

		if (!element || element.name === null) return null;
		const info = classNameOf(source, element);

		if (!info.editable) return null;
		const next = setClassName(source, start, change(info.classes));

		return next === null ? null : { source: next, start };
	};

const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);

/** The classes every element has, in the first one's order: a control reads a shared value from them */
export function sharedClasses(all: readonly string[]): string {
	const [first, ...rest] = all.map(tokens);

	if (!first) return "";
	const others = rest.map((list) => new Set(list));

	return first.filter((token) => others.every((set) => set.has(token))).join(" ");
}

/** The value every element has; `undefined` when they differ ("Mixed") */
export function commonValue<T>(values: readonly T[]): T | undefined {
	return values.every((value) => value === values[0]) ? values[0] : undefined;
}

/**
 * Applies a free edit of the shared classes (`before` → `after`) to one element's classes: removed tokens go, new ones
 * are added, the element's own tokens stay. An element whose classes are `before` gets `after` as typed.
 */
export function retoken(classes: string, before: string, after: string): string {
	const own = tokens(classes);
	const from = tokens(before);

	if (own.join(" ") === from.join(" ")) return after;
	const to = tokens(after);
	const removed = new Set(from.filter((token) => !to.includes(token)));
	const kept = own.filter((token) => !removed.has(token));

	return [...kept, ...to.filter((token) => !from.includes(token) && !kept.includes(token))].join(" ");
}

/** The source range the elements cover when they are adjacent siblings (in any order); `null` otherwise */
export function adjacentRange(source: string, starts: readonly number[]): { start: number; end: number } | null {
	const tree = parseJsx(source);
	const elements = starts.map((start) => findElement(tree, start));
	const parent = elements[0]?.parent;

	if (!parent || !elements.every((element): element is JsxElement => element?.parent === parent && !element.container))
		return null;

	// A lone space between inline siblings is a slot, but nothing a wrapper would leave out
	const slots = childSlots(parent).filter((slot) => source.slice(slot.start, slot.end).trim());

	const indices = elements
		.map((element) => slots.findIndex((slot) => slot.start === element.start))
		.sort((a, b) => a - b);

	if (indices[0] === -1 || indices.some((index, i) => i > 0 && index !== indices[i - 1]! + 1)) return null;

	return { start: slots[indices[0]!]!.start, end: slots[indices[indices.length - 1]!]!.end };
}

/** `wrapElement` for a run of siblings. `start` is the wrapper's offset */
export function wrapRange(
	source: string,
	range: { start: number; end: number },
	tag = "div",
	className?: string,
): Edited {
	const text = source.slice(range.start, range.end);
	const opening = className ? `<${tag} className=${attrValue(className)}>` : `<${tag}>`;
	const splice = (inner: string) => source.slice(0, range.start) + inner + source.slice(range.end);

	if (!startsLine(source, range.start)) return { source: splice(`${opening}${text}</${tag}>`), start: range.start };

	const indent = indentAt(source, range.start);
	const unit = indentUnit(source);
	const inner = reindent(dedent(text, indent), indent + unit, unit);

	return { source: splice(`${opening}\n${inner}\n${indent}</${tag}>`), start: range.start };
}
