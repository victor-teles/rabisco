// Text styles are `text-*` tokens: one class sets the size, line height, weight and tracking (decision 0044)

import { parseTextStyle } from "../context/tokens";
import { setStyle } from "./classes";

const WEIGHTS = new Map([
	["normal", "400"],
	["bold", "700"],
]);

/** The style's class replaces the element's size, line height, weight and tracking, so the style shows as designed */
export function applyTextStyle(classes: string, utility: string, variant = ""): string {
	const sized = setStyle(classes, "fontSize", utility, variant);
	const spaced = setStyle(sized, "lineHeight", null, variant);

	return setStyle(setStyle(spaced, "fontWeight", null, variant), "letterSpacing", null, variant);
}

/** The style's values as the element's own classes, so it looks the same without the token */
export function detachTextStyle(classes: string, value: string, variant = ""): string {
	const style = parseTextStyle(value);

	if (!style) return classes;
	const size = style.lineHeight === undefined ? `[${style.size}]` : `[${style.size}]/[${style.lineHeight}]`;
	let next = setStyle(classes, "fontSize", size, variant);

	if (style.weight !== undefined)
		next = setStyle(next, "fontWeight", `[${WEIGHTS.get(style.weight) ?? style.weight}]`, variant);

	if (style.tracking !== undefined) next = setStyle(next, "letterSpacing", `[${style.tracking}]`, variant);

	return next;
}
