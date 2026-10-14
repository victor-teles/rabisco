import { flatten, parseJsx } from "../jsx";

/** `start, end` of every JSX element, flat, so the share viewer can show the TSX of a selected element */
export function elementSpans(source: string): number[] {
	return flatten(parseJsx(source)).flatMap((element) => [element.start, element.end]);
}
