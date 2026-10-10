import { getStyle, setStyle, type SimpleProp } from "./classes";

export type Align = "start" | "center" | "end";

export type Cell = { x: Align; y: Align };

export type Direction = "row" | "col";

export type AutoLayout = { direction: Direction; cell: Cell; spaced: boolean };

const SPACED = new Set(["between", "around", "evenly"]);

const effective = (classes: string, prop: SimpleProp, variant: string) =>
	getStyle(classes, prop, variant) ?? (variant ? getStyle(classes, prop) : null);

const flip = (align: Align): Align => (align === "start" ? "end" : align === "end" ? "start" : align);

function alignOf(value: string | null): Align {
	if (value === "center" || value === "center-safe") return "center";

	if (value === "end" || value === "end-safe") return "end";

	return "start";
}

function directionOf(classes: string, variant: string) {
	const value = effective(classes, "flexDirection", variant);

	return { direction: value?.startsWith("col") ? "col" : "row", reversed: !!value?.endsWith("-reverse") } as const;
}

const cellOf = (direction: Direction, main: Align, cross: Align): Cell =>
	direction === "row" ? { x: main, y: cross } : { x: cross, y: main };

const axesOf = (direction: Direction, cell: Cell) =>
	direction === "row" ? { main: cell.x, cross: cell.y } : { main: cell.y, cross: cell.x };

export function readAutoLayout(classes: string, variant = ""): AutoLayout {
	const { direction, reversed } = directionOf(classes, variant);
	const justify = effective(classes, "justifyContent", variant);
	const spaced = justify !== null && SPACED.has(justify);
	const main = spaced ? "start" : alignOf(justify);

	return {
		direction,
		cell: cellOf(direction, reversed ? flip(main) : main, alignOf(effective(classes, "alignItems", variant))),
		spaced,
	};
}

function writeJustify(classes: string, value: Align | "between", variant: string) {
	if (value !== "start") return setStyle(classes, "justifyContent", value, variant);
	const base = variant ? getStyle(classes, "justifyContent") : null;

	return setStyle(classes, "justifyContent", base !== null && base !== "start" ? "start" : null, variant);
}

function writeAxes(classes: string, cell: Cell, spaced: boolean, variant: string) {
	const { direction, reversed } = directionOf(classes, variant);
	const { main, cross } = axesOf(direction, cell);
	const justified = writeJustify(classes, spaced ? "between" : reversed ? flip(main) : main, variant);

	if (alignOf(effective(classes, "alignItems", variant)) === cross) return justified;

	return setStyle(justified, "alignItems", cross, variant);
}

export const setAlignment = (classes: string, cell: Cell, variant = "") =>
	writeAxes(classes, cell, readAutoLayout(classes, variant).spaced, variant);

export function setSpaced(classes: string, spaced: boolean, variant = ""): string {
	const before = readAutoLayout(classes, variant);

	return writeAxes(classes, before.cell, spaced, variant);
}

export function setDirection(classes: string, direction: Direction, variant = ""): string {
	const before = readAutoLayout(classes, variant);
	const base = variant ? getStyle(classes, "flexDirection") : null;
	const reset = base !== null && base !== "row" ? "row" : null;
	const next = setStyle(classes, "flexDirection", direction === "row" ? reset : direction, variant);

	return writeAxes(next, before.cell, before.spaced, variant);
}
