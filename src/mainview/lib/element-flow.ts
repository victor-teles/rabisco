import { findElement, moveAmongSiblings, parseJsx } from "../../shared/jsx";
import { classNameOf, getStyle, type SimpleProp } from "../../shared/tailwind/classes";
import { selectableChildren, selectableParent } from "./element-nav";
import type { Edited } from "./element-selection";

export type FlowKind = "row" | "column" | "grid" | "block";

export type Flow = { kind: FlowKind; reverse: boolean; columns: number };

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

const BREAKPOINTS: { variant: string; width: number }[] = [
	{ variant: "sm", width: 640 },
	{ variant: "md", width: 768 },
	{ variant: "lg", width: 1024 },
	{ variant: "xl", width: 1280 },
	{ variant: "2xl", width: 1536 },
];

export function styleAt(classes: string, prop: SimpleProp, width: number | null): string | null {
	let value = getStyle(classes, prop);

	for (const breakpoint of BREAKPOINTS) {
		if (width === null || width < breakpoint.width) break;

		value = getStyle(classes, prop, breakpoint.variant) ?? value;
	}

	return value;
}

export function flowOf(classes: string, width: number | null): Flow {
	const display = styleAt(classes, "display", width);

	if (display === "flex" || display === "inline-flex") {
		const direction = styleAt(classes, "flexDirection", width) ?? "row";

		return {
			kind: direction.startsWith("col") ? "column" : "row",
			reverse: direction.endsWith("reverse"),
			columns: 1,
		};
	}

	if (display === "grid" || display === "inline-grid") {
		const columns = Number(styleAt(classes, "gridColumns", width));

		return { kind: "grid", reverse: false, columns: Number.isInteger(columns) && columns > 0 ? columns : 1 };
	}

	return { kind: "block", reverse: false, columns: 1 };
}

export type ParentOf = { start: number; classes: string; flow: Flow; children: number[] };

export function parentOf(source: string, start: number, width: number | null): ParentOf | null {
	const element = findElement(parseJsx(source), start);
	const parent = element && selectableParent(element);

	if (!parent) return null;

	const info = classNameOf(source, parent);

	if (!info.editable || !parent.intrinsic) return null;

	return {
		start: parent.start,
		classes: info.classes,
		flow: flowOf(info.classes, width),
		children: selectableChildren(parent).map((child) => child.start),
	};
}

export function arrowSteps(flow: Flow | null, key: ArrowKey): number | null {
	const horizontal = key === "ArrowLeft" || key === "ArrowRight";
	const forward = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;

	if (!flow) return forward;

	if (flow.kind === "grid") return horizontal ? forward : forward * flow.columns;

	if (horizontal !== (flow.kind === "row")) return null;

	return flow.reverse ? -forward : forward;
}

export function moveSteps(source: string, start: number, steps: number): Edited | null {
	if (!steps) return null;

	let current: Edited = { source, start };

	for (let i = 0; i < Math.abs(steps); i++) {
		const next = moveAmongSiblings(current.source, current.start, steps < 0 ? -1 : 1);

		if (!next) return null;

		current = next;
	}

	return current;
}
