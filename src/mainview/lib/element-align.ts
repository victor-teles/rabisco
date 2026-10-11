import { getBox, setBoxParts, setClassName, setStyle, splitClasses } from "../../shared/tailwind/classes";
import type { Alignment, Axis } from "./align";
import { parentOf, type ParentOf } from "./element-flow";
import { editEach, restyle, type Edited } from "./element-selection";

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
): Arranged {
	const parent = siblings(source, starts, width);

	if ("refusal" in parent) return parent;

	const axis = axisOf(alignment);
	const position = POSITIONS[alignment];
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
): Arranged {
	const parent = siblings(source, starts, width);

	if ("refusal" in parent) return parent;

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
