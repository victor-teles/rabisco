import { flatten, parseFile } from "../jsx/tree";
import { classNameOf, parseClass, splitClasses } from "./classes";

const HIDDEN = "hidden";

const DISPLAYS = new Set([
	"block",
	"inline-block",
	"inline",
	"flex",
	"inline-flex",
	"grid",
	"inline-grid",
	"table",
	"inline-table",
	"table-caption",
	"table-cell",
	"table-column",
	"table-column-group",
	"table-footer-group",
	"table-header-group",
	"table-row-group",
	"table-row",
	"flow-root",
	"contents",
	"list-item",
]);

const isBase = (token: string) => parseClass(token).variants.length === 0;

const isHiddenToken = (token: string) => {
	const parsed = parseClass(token);

	return parsed.variants.length === 0 && !parsed.negative && parsed.utility === HIDDEN;
};

export function baseClasses(classes: string): string {
	return splitClasses(classes).filter(isBase).join(" ");
}

export function pasteProperties(classes: string, copied: string): string {
	const variants = splitClasses(classes).filter((token) => !isBase(token));

	return [...splitClasses(baseClasses(copied)), ...variants].join(" ");
}

export const isHidden = (classes: string) => splitClasses(classes).some(isHiddenToken);

export function setHidden(classes: string, hidden: boolean): string {
	const kept = splitClasses(classes).filter((token) => !isHiddenToken(token));

	if (!hidden) return kept.join(" ");
	const displayed = kept.some((token) => DISPLAYS.has(parseClass(token).utility));

	return [...kept, displayed ? `${HIDDEN}!` : HIDDEN].join(" ");
}

export function hiddenStarts(source: string): number[] {
	const parsed = parseFile(source);

	return flatten(parsed).flatMap((element) =>
		element.name !== null && isHidden(classNameOf(source, element).classes) ? [element.start] : [],
	);
}
