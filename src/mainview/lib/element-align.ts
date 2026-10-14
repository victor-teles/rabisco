import { findElement, parseJsx } from "../../shared/jsx";
import {
	classNameOf,
	getBox,
	getStyle,
	parseClass,
	setBoxParts,
	setClassName,
	setStyle,
	splitClasses,
	variantOf,
} from "../../shared/tailwind/classes";
import type { Alignment, Axis } from "./align";
import { activeVariants, parentOf, styleAt, type ParentOf } from "./element-flow";
import { editEach, restyle, type Edited } from "./element-selection";
import type { Placement } from "./render/protocol";

export type Arranged = { source: string; starts: number[] } | { refusal: string };

type Position = "start" | "center" | "end";

const POSITIONS: Record<Alignment, Position> = {
	left: "start",
	"h-center": "center",
	right: "end",
	top: "start",
	"v-middle": "center",
	bottom: "end",
};

const FLIPPED: Record<Position, Position> = { start: "end", center: "center", end: "start" };

const axisOf = (alignment: Alignment): Axis =>
	alignment === "left" || alignment === "h-center" || alignment === "right" ? "horizontal" : "vertical";

const NOT_SIBLINGS = "Select elements in the same parent to arrange them";

const PLAIN_PARENT = "Their parent needs plain classes to arrange them";

const PLAIN_CLASSES = "Only elements with plain classes can be arranged";

function siblings(source: string, starts: readonly number[], width: number | null): ParentOf | { refusal: string } {
	const parents = starts.map((start) => parentOf(source, start, width));
	const [parent] = parents;

	if (!parent) return { refusal: PLAIN_PARENT };

	if (!parents.every((other) => other?.start === parent.start)) return { refusal: NOT_SIBLINGS };

	return starts.every((start) => parent.children.includes(start)) ? parent : { refusal: NOT_SIBLINGS };
}

const FREE = new Set(["absolute", "fixed"]);

function freeCount(source: string, starts: readonly number[], width: number | null) {
	const root = parseJsx(source);

	return starts.filter((start) => {
		const element = findElement(root, start);
		const info = element && classNameOf(source, element);

		return FREE.has((info?.editable && styleAt(info.classes, "position", width)) || "");
	}).length;
}

export const needsPlacements = (source: string, starts: readonly number[], width: number | null) =>
	freeCount(source, starts, width) > 0;

const MIXED = "Absolutely positioned elements can't be arranged with elements in the flow";

type Span = { start: number; size: number };

const AXES = {
	horizontal: { near: "left", far: "right", dimension: "width", translate: "x", other: "y" },
	vertical: { near: "top", far: "bottom", dimension: "height", translate: "y", other: "x" },
} as const;

const spanOf = ({ box }: Placement, axis: Axis): Span =>
	axis === "horizontal" ? { start: box.x, size: box.width } : { start: box.y, size: box.height };

const SPACING_UNIT = 4;

function pixels(px: number) {
	const rounded = Math.round(Math.abs(px) * 100) / 100;
	const value = rounded === 1 ? "px" : rounded % 2 === 0 ? String(rounded / SPACING_UNIT) : `[${rounded}px]`;

	return px < 0 && rounded ? `-${value}` : value;
}

const isSet = (value: string | null) => value !== null && value !== "auto";

function lastSet(variants: readonly string[], read: (variant: string) => string | null) {
	let value: string | null = null;

	for (const variant of variants) value = read(variant) ?? value;

	return value;
}

const TRANSLATE_BOTH = /^translate-(?!x-|y-|z-|none$|3d$|\[|\()/;

function translates(classes: string, axis: Axis, variant: string) {
	const { translate } = AXES[axis];

	return splitClasses(classes).some((token) => {
		const parsed = parseClass(token);

		return (
			variantOf(parsed) === variant &&
			(parsed.utility.startsWith(`translate-${translate}-`) || TRANSLATE_BOTH.test(parsed.utility))
		);
	});
}

function withoutTranslate(classes: string, axis: Axis, variant: string, below: readonly string[]) {
	const { translate, other } = AXES[axis];

	const kept = splitClasses(classes).flatMap((token) => {
		const parsed = parseClass(token);

		if (variantOf(parsed) !== variant) return [token];

		if (parsed.utility.startsWith(`translate-${translate}-`)) return [];

		return TRANSLATE_BOTH.test(parsed.utility) ? [token.replace("translate-", `translate-${other}-`)] : [token];
	});

	const inherited = below.some((lower) => translates(classes, axis, lower));
	const reset = inherited ? [`${variant ? `${variant}:` : ""}translate-${translate}-0`] : [];

	return [...kept, ...reset].join(" ");
}

function setsPlacement(classes: string, variant: string) {
	return (
		getStyle(classes, "position", variant) !== null ||
		Object.values(getBox(classes, "inset", variant)).some((value) => value !== null) ||
		translates(classes, "horizontal", variant) ||
		translates(classes, "vertical", variant)
	);
}

function placeAlong(classes: string, axis: Axis, offset: number, size: number, width: number | null) {
	const { near, far, dimension } = AXES[axis];
	const variants = activeVariants(width);
	let at = 0;

	variants.forEach((variant, i) => {
		if (setsPlacement(classes, variant)) at = i;
	});

	const variant = variants[at]!;
	const upTo = variants.slice(0, at + 1);
	const below = variants.slice(0, at);
	const inset = (part: string) => (lower: string) => getBox(classes, "inset", lower)[part] ?? null;

	const stretched =
		isSet(lastSet(upTo, inset(near))) &&
		isSet(lastSet(upTo, inset(far))) &&
		lastSet(upTo, (lower) => getBox(classes, "size", lower)[dimension] ?? null) === null;

	const placed = setBoxParts(classes, "inset", [near], pixels(offset), variant);
	const freed = setBoxParts(placed, "inset", [far], isSet(lastSet(below, inset(far))) ? "auto" : null, variant);
	const sized = stretched ? setBoxParts(freed, "size", [dimension], pixels(size), variant) : freed;

	return withoutTranslate(sized, axis, variant, below);
}

function alignedSpans(placements: readonly Placement[], axis: Axis, position: Position): Span[] {
	const spans = placements.map((placement) => spanOf(placement, axis));
	const [only] = placements;
	const container = only && placements.length === 1 ? only.container[AXES[axis].dimension] : null;
	const from = container === null ? Math.min(...spans.map((span) => span.start)) : 0;
	const to = container ?? Math.max(...spans.map((span) => span.start + span.size));

	return spans.map(({ size }) => ({
		start: position === "start" ? from : position === "center" ? from + (to - from - size) / 2 : to - size,
		size,
	}));
}

function distributedSpans(placements: readonly Placement[], axis: Axis): Span[] {
	const spans = placements.map((placement) => spanOf(placement, axis));
	const order = spans.map((_, i) => i).sort((a, b) => spans[a]!.start - spans[b]!.start);
	const from = Math.min(...spans.map((span) => span.start));
	const to = Math.max(...spans.map((span) => span.start + span.size));
	const gap = (to - from - spans.reduce((sum, span) => sum + span.size, 0)) / Math.max(1, spans.length - 1);
	const placed = [...spans];
	let next = from;

	for (const i of order) {
		placed[i] = { start: next, size: spans[i]!.size };
		next += spans[i]!.size + gap;
	}

	return placed;
}

function placeEach(
	source: string,
	starts: readonly number[],
	axis: Axis,
	placements: readonly Placement[],
	spans: readonly Span[],
	width: number | null,
): Arranged {
	const margin = axis === "horizontal" ? "x" : "y";

	const edited = editEach(source, starts, (current, start) => {
		const i = starts.indexOf(start);
		const span = spans[i];
		const placement = placements[i];

		return span && placement
			? restyle((classes) => placeAlong(classes, axis, span.start - placement.margin[margin], span.size, width))(
					current,
					start,
				)
			: null;
	});

	const placed = edited.starts.flatMap((start) => (start === null ? [] : [start]));

	return placed.length === starts.length ? { source: edited.source, starts: placed } : { refusal: PLAIN_CLASSES };
}

function arrangeFree(
	source: string,
	starts: readonly number[],
	width: number | null,
	placements: readonly Placement[] | null,
	spans: (placements: readonly Placement[]) => Span[],
	axis: Axis,
): Arranged | null {
	const free = freeCount(source, starts, width);

	if (!free) return null;

	if (free < starts.length) return { refusal: MIXED };

	if (!placements) return { source, starts: [...starts] };

	if (placements.length !== starts.length) return { refusal: "Couldn't measure the elements. Try again" };

	return placeEach(source, starts, axis, placements, spans(placements), width);
}

const everyChild = (parent: ParentOf, starts: readonly number[]) =>
	parent.children.every((child) => starts.includes(child));

const kept =
	(change: (classes: string) => string) =>
	(source: string, start: number): Edited =>
		restyle(change)(source, start) ?? { source, start };

function arrange(
	source: string,
	starts: readonly number[],
	child: ((classes: string) => string) | null,
	parent: { start: number; classes: string } | null,
): Arranged {
	const edit = child && (parent ? kept(child) : restyle(child));
	const edited = edit ? editEach(source, starts, edit) : { source, starts: [...starts] };

	if (edited.starts.every((start) => start === null)) return { refusal: PLAIN_CLASSES };

	const next = parent ? setClassName(edited.source, parent.start, parent.classes) : edited.source;

	if (next === null) return { refusal: PLAIN_PARENT };

	const shift = next.length - edited.source.length;

	return { source: next, starts: edited.starts.flatMap((start) => (start === null ? [] : [start + shift])) };
}

function setJustifySelf(classes: string, position: Position) {
	const kept = splitClasses(classes).filter((token) => !token.startsWith("justify-self-"));

	return [...kept, `justify-self-${position}`].join(" ");
}

function setAutoMargins(classes: string, position: Position) {
	const margin = getBox(classes, "margin");
	const cleared = (value: string | null) => (value === "auto" ? null : value);
	const left = position === "start" ? cleared(margin.left ?? null) : "auto";
	const right = position === "center" ? "auto" : cleared(margin.right ?? null);

	return setBoxParts(setBoxParts(classes, "margin", ["left"], left), "margin", ["right"], right);
}

export function alignElements(
	source: string,
	starts: readonly number[],
	alignment: Alignment,
	width: number | null,
	placements: readonly Placement[] | null = null,
): Arranged {
	const parent = siblings(source, starts, width);

	if ("refusal" in parent) return parent;

	const axis = axisOf(alignment);
	const position = POSITIONS[alignment];
	const free = arrangeFree(source, starts, width, placements, (all) => alignedSpans(all, axis, position), axis);

	if (free) return free;
	const { flow } = parent;

	if (flow.kind === "grid")
		return arrange(
			source,
			starts,
			(classes) =>
				axis === "horizontal" ? setJustifySelf(classes, position) : setStyle(classes, "alignSelf", position),
			null,
		);

	if (flow.kind === "block") {
		if (axis === "vertical")
			return { refusal: "Elements in normal flow stack top to bottom. Add auto layout to align them" };

		return arrange(source, starts, (classes) => setAutoMargins(classes, position), null);
	}

	const main: Axis = flow.kind === "row" ? "horizontal" : "vertical";
	const all = everyChild(parent, starts);

	if (axis === main) {
		if (!all) return { refusal: `Select every child of the ${flow.kind} to align them along it` };

		const justify = flow.reverse ? FLIPPED[position] : position;

		return arrange(source, starts, null, {
			start: parent.start,
			classes: setStyle(parent.classes, "justifyContent", justify),
		});
	}

	if (all)
		return arrange(source, starts, (classes) => setStyle(classes, "alignSelf", null), {
			start: parent.start,
			classes: setStyle(parent.classes, "alignItems", position),
		});

	return arrange(source, starts, (classes) => setStyle(classes, "alignSelf", position), null);
}

export function distributeElements(
	source: string,
	starts: readonly number[],
	axis: Axis,
	width: number | null,
	placements: readonly Placement[] | null = null,
): Arranged {
	const parent = siblings(source, starts, width);

	if ("refusal" in parent) return parent;

	const free = arrangeFree(source, starts, width, placements, (all) => distributedSpans(all, axis), axis);

	if (free) return free;

	const { flow } = parent;

	if (flow.kind !== "row" && flow.kind !== "column")
		return { refusal: "Distribute works on the children of a flex row or column" };

	const main: Axis = flow.kind === "row" ? "horizontal" : "vertical";

	if (axis !== main) return { refusal: `These elements sit in a ${flow.kind}, so they distribute along it` };

	if (!everyChild(parent, starts) || parent.children.length < 2)
		return { refusal: `Select every child of the ${flow.kind} to distribute them` };

	const sides = main === "horizontal" ? ["left", "right"] : ["top", "bottom"];

	return arrange(source, starts, (classes) => setBoxParts(classes, "margin", sides, null), {
		start: parent.start,
		classes: setStyle(parent.classes, "justifyContent", "between"),
	});
}
