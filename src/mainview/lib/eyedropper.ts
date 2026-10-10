import { parseColor, toHex, type Rgba } from "../../shared/export/color";

export type ColorCandidate = { value: string; css: string | null };

const TOLERANCE = 2;

const distance = (a: Rgba, b: Rgba) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));

function nearest(color: Rgba, candidates: readonly ColorCandidate[]) {
	let best: { value: string; distance: number } | null = null;

	for (const candidate of candidates) {
		const rgba = candidate.css === null ? null : parseColor(candidate.css);

		if (!rgba || rgba.a < 1) continue;
		const gap = distance(color, rgba);

		if (gap <= TOLERANCE && (!best || gap < best.distance)) best = { value: candidate.value, distance: gap };
	}

	return best?.value ?? null;
}

export function snapColor(css: string, groups: readonly (readonly ColorCandidate[])[]): string | null {
	const color = parseColor(css);

	if (!color) return null;

	if (color.a === 0) return "transparent";
	const opacity = Math.round(color.a * 100);
	const token = groups.reduce<string | null>((found, group) => found ?? nearest(color, group), null);
	const base = token ?? `[${toHex(color)}]`;

	return opacity >= 100 ? base : `${base}/${opacity}`;
}
