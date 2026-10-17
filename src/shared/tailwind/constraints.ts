// Constraints pin an absolutely positioned element to the sides of its parent, written as `inset-*` classes

import { getBox, parseClass, setBox, splitClasses, variantOf } from "./classes";

export type ConstraintAxis = "x" | "y";

/** Left, right, left and right, center (or top, bottom…) */
export type Constraint = "start" | "end" | "both" | "center";

export const CONSTRAINTS: readonly Constraint[] = ["start", "end", "both", "center"];

export const CONSTRAINT_LABELS: Record<ConstraintAxis, Record<Constraint, string>> = {
	x: { start: "Left", end: "Right", both: "Left and right", center: "Center" },
	y: { start: "Top", end: "Bottom", both: "Top and bottom", center: "Center" },
};

const SIDES: Record<ConstraintAxis, readonly [string, string]> = { x: ["left", "right"], y: ["top", "bottom"] };

const CENTER: Record<ConstraintAxis, string> = { x: "translate-x-1/2", y: "translate-y-1/2" };

const pinned = (value: string | null | undefined): value is string => value != null && value !== "auto";

const isCentering = (raw: string, axis: ConstraintAxis, variant: string) => {
	const parsed = parseClass(raw);

	return parsed.negative && parsed.utility === CENTER[axis] && variantOf(parsed) === variant;
};

export function readConstraint(classes: string, axis: ConstraintAxis, variant = ""): Constraint | null {
	const box = getBox(classes, "inset", variant);
	const [start, end] = SIDES[axis].map((side) => box[side]);

	if (start === "1/2" && splitClasses(classes).some((raw) => isCentering(raw, axis, variant))) return "center";

	if (pinned(start) && pinned(end)) return "both";

	if (pinned(end)) return "end";

	return pinned(start) ? "start" : null;
}

/** A side that was pinned keeps its offset; a newly pinned side starts at 0; `null` unpins both */
export function setConstraint(
	classes: string,
	axis: ConstraintAxis,
	constraint: Constraint | null,
	variant = "",
): string {
	const box = getBox(classes, "inset", variant);
	const [startSide, endSide] = SIDES[axis];
	const offset = (side: string) => (pinned(box[side]) && box[side] !== "1/2" ? box[side]! : "0");
	const kept = splitClasses(classes).flatMap((raw) => (isCentering(raw, axis, variant) ? [] : [raw]));

	const start =
		constraint === "start" || constraint === "both" ? offset(startSide) : constraint === "center" ? "1/2" : null;

	const next = setBox(
		kept.join(" "),
		"inset",
		{ ...box, [startSide]: start, [endSide]: constraint === "end" || constraint === "both" ? offset(endSide) : null },
		variant,
	);

	if (constraint !== "center") return next;
	const centering = `${variant ? `${variant}:` : ""}-${CENTER[axis]}`;

	return next ? `${next} ${centering}` : centering;
}
