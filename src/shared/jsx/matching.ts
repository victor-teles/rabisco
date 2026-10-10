import { classNameOf, splitClasses } from "../tailwind/classes";
import { findElement, flatten, parseFile, type JsxElement } from "./tree";

function classKey(source: string, element: JsxElement): string {
	const info = classNameOf(source, element);
	const text = info.kind === "dynamic" ? (info.text ?? "") : info.classes;

	return [...new Set(splitClasses(text))].sort().join(" ");
}

export function matchingStarts(source: string, start: number): number[] {
	const parsed = parseFile(source);
	const target = parsed.ok ? findElement(parsed, start) : null;

	if (!target || target.name === null) return [];

	if (!target.intrinsic)
		return flatten(parsed).flatMap((element) => (element.name === target.name ? [element.start] : []));
	const key = classKey(source, target);

	const matches = (element: JsxElement) =>
		element.intrinsic && classKey(source, element) === key && (key !== "" || element.name === target.name);

	return flatten(parsed).flatMap((element) => (matches(element) ? [element.start] : []));
}
