import { isVisible, parseColor } from "../../shared/export/color";

const paints = (color: string) => isVisible(parseColor(color));

function overText(element: Element, x: number, y: number) {
	const range = document.createRange();

	for (const node of element.childNodes) {
		if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
		range.selectNodeContents(node);

		for (const rect of range.getClientRects())
			if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
	}

	return false;
}

function vectorPaint(element: Element) {
	if (!(element instanceof SVGElement) || element instanceof SVGSVGElement) return null;
	const style = getComputedStyle(element);

	if (paints(style.fill)) return style.fill;

	return paints(style.stroke) ? style.stroke : null;
}

export function colorAt(x: number, y: number): string | null {
	const target = document.elementFromPoint(x, y);

	if (!target) return null;

	if (overText(target, x, y)) return getComputedStyle(target).color;
	const vector = vectorPaint(target);

	if (vector) return vector;

	for (let element: Element | null = target; element; element = element.parentElement) {
		const background = getComputedStyle(element).backgroundColor;

		if (paints(background)) return background;
	}

	return null;
}
