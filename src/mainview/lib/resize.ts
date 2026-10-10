// Pure logic behind the canvas handles that resize an element and drag its padding and gap: pointer deltas become
// values on the Tailwind spacing scale, and those values become classes.
import {
	boxClasses,
	getBox,
	getStyle,
	setBoxParts,
	setStyle,
	SPACING_SCALE,
	type Box as ClassBox,
} from "../../shared/tailwind/classes";
import type { Axis, ElementLayout, Insets } from "./render/spacing";

export type Dimension = "width" | "height";

/** Figma's auto layout sizing: a fixed size, the size of the content, or the room the parent leaves */
export type SizeMode = "fixed" | "hug" | "fill";

/** The parent's flex direction; `null` when the parent isn't a flex container */
export type ParentAxis = Axis | null;

type Point = { x: number; y: number };

/** CSS properties set inline on the live frame while a handle drags */
export type PreviewStyle = Record<string, string>;

/** Tailwind's spacing unit */
const SPACING_UNIT = 4;

/** Beyond the named steps (96, 384px), Tailwind v4 takes any whole multiple of the unit */
const STEPS: { value: string; px: number }[] = SPACING_SCALE.options.map((option) => ({
	value: option.value,
	px: option.value === "px" ? 1 : Number(option.value) * SPACING_UNIT,
}));

const LAST_STEP = STEPS.at(-1)!;

/** The nearest value on the spacing scale: `64` for 256px, `px` for 1px */
export function spacingValue(px: number): string {
	if (px <= 0) return "0";

	if (px > LAST_STEP.px) return String(Math.round(px / SPACING_UNIT));
	let best = STEPS[0]!;

	for (const step of STEPS) if (Math.abs(step.px - px) < Math.abs(best.px - px)) best = step;

	return best.value;
}

/** CSS pixels of a spacing value; `null` for values off the numeric scale (`full`, `[13px]`) */
export function spacingPixels(value: string): number | null {
	if (value === "px") return 1;
	const steps = Number(value);

	return value.trim() && Number.isFinite(steps) && steps >= 0 ? steps * SPACING_UNIT : null;
}

/** The dimension a flex parent grows its children along */
const mainDimension = (parent: ParentAxis): Dimension | null =>
	parent === "row" ? "width" : parent === "column" ? "height" : null;

const grows = (classes: string) => getStyle(classes, "flex") === "1" || getStyle(classes, "flexGrow") !== null;

/** Drops `flex-1` and `grow`, which would override the size along the parent's main axis */
const withoutGrow = (classes: string) => setStyle(setStyle(classes, "flex", null), "flexGrow", null);

export function sizeMode(classes: string, dimension: Dimension, parent: ParentAxis): SizeMode {
	if (mainDimension(parent) === dimension && grows(classes)) return "fill";
	const value = getBox(classes, "size")[dimension];

	if (value === "full") return "fill";

	if (value === null || value === "fit" || value === "auto") return "hug";

	return "fixed";
}

/** A fixed size: `w-64`; a grown child stops growing so the size shows */
export function setFixedSize(classes: string, dimension: Dimension, value: string, parent: ParentAxis): string {
	const base = mainDimension(parent) === dimension ? withoutGrow(classes) : classes;

	return setBoxParts(base, "size", [dimension], value);
}

/** `flex-1` along a flex parent's main axis, `w-full` / `h-full` otherwise */
export function setFill(classes: string, dimension: Dimension, parent: ParentAxis): string {
	if (mainDimension(parent) === dimension)
		return setStyle(setBoxParts(classes, "size", [dimension], null), "flex", "1");

	return setBoxParts(classes, "size", [dimension], "full");
}

/**
 * The size of the content. A flex child already hugs along the main axis, and a block hugs its height, so the size
 * class just goes; elsewhere (a block's width, a stretched cross axis) it takes `w-fit` / `h-fit`.
 */
export function setHug(classes: string, dimension: Dimension, parent: ParentAxis): string {
	const main = mainDimension(parent);
	const base = main === dimension ? withoutGrow(classes) : classes;
	const hugsAlready = main === dimension || (parent === null && dimension === "height");

	return setBoxParts(base, "size", [dimension], hugsAlready ? null : "fit");
}

export function setSizeMode(
	classes: string,
	dimension: Dimension,
	mode: SizeMode,
	parent: ParentAxis,
	/** The rendered size, for `fixed` */
	px: number,
): string {
	if (mode === "fill") return setFill(classes, dimension, parent);

	if (mode === "hug") return setHug(classes, dimension, parent);

	return setFixedSize(classes, dimension, spacingValue(px), parent);
}

/** Edges and corners, by compass point */
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const RESIZE_HANDLES: readonly ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function handleDimensions(handle: ResizeHandle): Dimension[] {
	const dimensions: Dimension[] = [];

	if (handle.includes("e") || handle.includes("w")) dimensions.push("width");

	if (handle.includes("n") || handle.includes("s")) dimensions.push("height");

	return dimensions;
}

/** Where a handle sits on the box, as fractions of its size */
export function handlePosition(handle: ResizeHandle): Point {
	const x = handle.includes("w") ? 0 : handle.includes("e") ? 1 : 0.5;
	const y = handle.includes("n") ? 0 : handle.includes("s") ? 1 : 0.5;

	return { x, y };
}

/**
 * The size a handle drag asks for, in CSS pixels, for the dimensions it moves. Elements sit in the flow, so the
 * west and north handles grow the element the same way the east and south ones do, just in the other direction.
 */
export function resizedSize(
	handle: ResizeHandle,
	start: { width: number; height: number },
	delta: Point,
): Partial<Record<Dimension, number>> {
	const size: Partial<Record<Dimension, number>> = {};

	if (handle.includes("e")) size.width = start.width + delta.x;
	else if (handle.includes("w")) size.width = start.width - delta.x;

	if (handle.includes("s")) size.height = start.height + delta.y;
	else if (handle.includes("n")) size.height = start.height - delta.y;

	for (const dimension of ["width", "height"] as const)
		if (size[dimension] !== undefined) size[dimension] = Math.max(0, size[dimension]);

	return size;
}

/** The size classes being written, for the label during a drag: `w-64`, `size-10` */
export function sizeLabel(values: Partial<Record<Dimension, string>>): string {
	return boxClasses("size", { width: values.width ?? null, height: values.height ?? null }).join(" ");
}

export type Side = keyof Insets;

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

/** ⌥ drags every side, ⇧ the side and its opposite, as in Figma */
export type SpacingModifiers = { all: boolean; symmetric: boolean };

export function paddingSides(side: Side, modifiers: SpacingModifiers): Side[] {
	if (modifiers.all) return [...SIDES];

	return modifiers.symmetric ? [side, OPPOSITE[side]] : [side];
}

/** Dragging a padding handle toward the element's center grows that side */
export function draggedPadding(side: Side, start: Insets, delta: Point): number {
	const inward = side === "top" ? delta.y : side === "bottom" ? -delta.y : side === "left" ? delta.x : -delta.x;

	return Math.max(0, start[side] + inward);
}

/** The padding parts a drag writes, by side; `value` is on the spacing scale */
export function paddingBox(sides: readonly Side[], value: string): ClassBox {
	return Object.fromEntries(SIDES.map((side) => [side, sides.includes(side) ? value : null]));
}

export const paddingLabel = (sides: readonly Side[], value: string) =>
	boxClasses("padding", paddingBox(sides, value)).join(" ");

export function setPadding(classes: string, sides: readonly Side[], value: string): string {
	return setBoxParts(classes, "padding", sides, value);
}

/** Inline styles that preview padding on the live frame */
export const paddingPreview = (sides: readonly Side[], px: number): PreviewStyle =>
	Object.fromEntries(sides.map((side) => [`padding-${side}`, `${px}px`]));

/** `x` is the space between columns, `y` between rows, as in `gap-x-*` / `gap-y-*` */
export type GapPart = "x" | "y";

/** A gap box runs between two children: a tall one separates columns */
export const gapPartOf = (gap: { width: number; height: number }): GapPart => (gap.width < gap.height ? "x" : "y");

export function draggedGap(part: GapPart, start: number, delta: Point): number {
	return Math.max(0, start + (part === "x" ? delta.x : delta.y));
}

/**
 * Which gap parts a drag writes. A flex container has one gap that matters, so it writes `gap-*` unless the classes
 * already split it; a grid writes the part being dragged, which folds back into `gap-*` when both match.
 */
export function gapParts(classes: string, part: GapPart, flow: ElementLayout["flow"]): GapPart[] {
	const current = getBox(classes, "gap");
	const split = current.x !== current.y;

	return flow === "grid" || split ? [part] : ["x", "y"];
}

export function setGap(classes: string, parts: readonly GapPart[], value: string): string {
	return setBoxParts(classes, "gap", parts, value);
}

export const gapLabel = (classes: string, parts: readonly GapPart[], value: string) =>
	boxClasses("gap", getBox(setGap(classes, parts, value), "gap")).join(" ");

const GAP_PROPERTIES: Record<GapPart, string> = { x: "column-gap", y: "row-gap" };

export const gapPreview = (parts: readonly GapPart[], px: number): PreviewStyle =>
	Object.fromEntries(parts.map((part) => [GAP_PROPERTIES[part], `${px}px`]));

/** Inline styles that preview a size; along a flex parent's main axis the element also stops growing */
export function sizePreview(sizes: Partial<Record<Dimension, number>>, parent: ParentAxis): PreviewStyle {
	const main = mainDimension(parent);

	return Object.fromEntries(
		(["width", "height"] as const).flatMap((dimension): [string, string][] => {
			const px = sizes[dimension];

			if (px === undefined) return [];

			return dimension === main
				? [
						[dimension, `${px}px`],
						["flex-grow", "0"],
						["flex-basis", "auto"],
					]
				: [[dimension, `${px}px`]];
		}),
	);
}
