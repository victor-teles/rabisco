import type { Rgba } from "../export/color";
import type { DesignFinding, DesignRule } from "./findings";

/** Document CSS pixels */
export type LayoutBox = { x: number; y: number; width: number; height: number };

/** What the frame reads from one rendered element; plain data so the checks run (and test) without a DOM. */
export type LayoutNode = {
	/** `path:start` of the nearest JSX element, from `data-rabisco-loc` */
	loc: string | null;
	tag: string;
	box: LayoutBox;
	scrollWidth: number;
	scrollHeight: number;
	clientWidth: number;
	clientHeight: number;
	overflowX: string;
	overflowY: string;
	/** The author asked for sideways scrolling (`overflow-x-auto`), as opposed to the `auto` CSS computes for X when only Y scrolls */
	scrollsX: boolean;
	textOverflow: string;
	lineClamp: number | null;
	position: string;
	display: string;
	hasNegativeMargin: boolean;
	hasTransform: boolean;
	color: Rgba | null;
	background: Rgba | null;
	hasBackgroundImage: boolean;
	opacity: number;
	fontSize: number;
	fontWeight: number;
	/** Direct text nodes, trimmed; empty when the element shows no text of its own */
	ownText: string;
	hasBorder: boolean;
	children: LayoutNode[];
};

/** `finding` has no `path`/`start`: the frame derives them from `loc` */
export type LayoutFinding = { loc: string | null; finding: DesignFinding };

/** Sub-pixel rounding makes boxes off by a fraction */
const TOLERANCE_PX = 1;

/** Borders that touch, or a shadow ring, are not an overlap */
const OVERLAP_PX = 4;

const EMPTY_CONTAINER_MIN_HEIGHT = 24;

const MAX_SCREEN_FONT_SIZES = 6;

const MAX_CARD_FONT_SIZES = 3;

const MIN_CONTRAST = 3;

const MIN_TEXT_CONTRAST = 4.5;

/** WCAG large text: 18pt, or 14pt bold */
const LARGE_TEXT_PX = 24;

const LARGE_BOLD_TEXT_PX = 18.66;

const BOLD_WEIGHT = 700;

const MAX_OVERFLOW_FINDINGS = 5;

/** A broken screen repeats the same mistake; a few findings per rule are enough to repair it */
const MAX_FINDINGS_PER_RULE = 10;

/** The frame shows a white page under the screen */
const PAGE_BACKGROUND: Rgba = { r: 255, g: 255, b: 255, a: 1 };

const channel = (value: number) => {
	const c = value / 255;

	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2 relative luminance of an opaque color */
export const relativeLuminance = ({ r, g, b }: Rgba) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG 2 contrast ratio, 1 to 21; alpha is ignored, so composite first */
export function contrastRatio(a: Rgba, b: Rgba) {
	const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);

	return (light! + 0.05) / (dark! + 0.05);
}

/** `top` painted over an opaque `bottom` */
export function composite(top: Rgba, bottom: Rgba): Rgba {
	const mix = (over: number, under: number) => Math.round(over * top.a + under * (1 - top.a));

	return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

const isLargeText = (node: LayoutNode) =>
	node.fontSize >= LARGE_TEXT_PX || (node.fontSize >= LARGE_BOLD_TEXT_PX && node.fontWeight >= BOLD_WEIGHT);

const right = (box: LayoutBox) => box.x + box.width;

const bottom = (box: LayoutBox) => box.y + box.height;

const hasPaint = (color: Rgba | null) => !!color && color.a > 0;

const isClipping = (overflow: string) => overflow === "hidden" || overflow === "clip";

const clipsX = (node: LayoutNode) => isClipping(node.overflowX) || node.scrollsX;

const quote = (text: string) => (text.length > 40 ? `"${text.slice(0, 39)}…"` : `"${text}"`);

const describe = (node: LayoutNode) => (node.ownText ? `<${node.tag}> ${quote(node.ownText)}` : `<${node.tag}>`);

/** One finding per rule and location (a `.map` repeats its element), capped per rule. */
class Findings {
	readonly list: LayoutFinding[] = [];
	#seen = new Set<string>();
	#counts = new Map<DesignRule, number>();

	add(
		node: LayoutNode,
		rule: DesignRule,
		severity: DesignFinding["severity"],
		message: string,
		cap = MAX_FINDINGS_PER_RULE,
	) {
		const key = `${rule} ${node.loc}`;
		const count = this.#counts.get(rule) ?? 0;

		if (this.#seen.has(key) || count >= cap) return;
		this.#seen.add(key);
		this.#counts.set(rule, count + 1);
		this.list.push({ loc: node.loc, finding: { rule, severity, message } });
	}
}

/** `display: contents` children take part in their grandparent's layout */
function layoutChildren(node: LayoutNode): LayoutNode[] {
	return node.children.flatMap((child) => (child.display === "contents" ? layoutChildren(child) : [child]));
}

/** Reports the element that sticks out past both its parent and the frame, not every ancestor of it. */
function checkOverflow(node: LayoutNode, parentRight: number, frameWidth: number, findings: Findings) {
	const contents = node.display === "contents";
	const edge = contents ? parentRight : right(node.box);

	if (!contents && node.box.width > 0 && edge > frameWidth + TOLERANCE_PX && edge > parentRight + TOLERANCE_PX) {
		const past = Math.round(edge - frameWidth);

		findings.add(
			node,
			"frame-overflow",
			"error",
			`${describe(node)} ends ${past}px past the ${Math.round(frameWidth)}px frame and makes it scroll sideways`,
			MAX_OVERFLOW_FINDINGS,
		);
	}

	// A scroller or a clipping parent owns what is inside it
	if (!contents && clipsX(node)) return;

	for (const child of node.children) checkOverflow(child, edge, frameWidth, findings);
}

function checkClippedText(node: LayoutNode, findings: Findings) {
	if (!node.ownText || node.textOverflow === "ellipsis" || node.lineClamp !== null) return;

	const clippedX =
		isClipping(node.overflowX) && node.clientWidth > 0 && node.scrollWidth > node.clientWidth + TOLERANCE_PX;

	const clippedY =
		isClipping(node.overflowY) && node.clientHeight > 0 && node.scrollHeight > node.clientHeight + TOLERANCE_PX;

	if (clippedX || clippedY)
		findings.add(
			node,
			"text-clipped",
			"error",
			`${describe(node)} is cut off. Let it wrap or grow, or truncate it on purpose with \`truncate\` or \`line-clamp-*\``,
		);
}

const inFlow = (node: LayoutNode) =>
	(node.position === "static" || node.position === "relative") &&
	node.display !== "inline" &&
	!node.hasNegativeMargin &&
	!node.hasTransform &&
	node.box.width > 0 &&
	node.box.height > 0;

const intersection = (a: LayoutBox, b: LayoutBox) => ({
	x: Math.min(right(a), right(b)) - Math.max(a.x, b.x),
	y: Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y),
});

function checkOverlap(node: LayoutNode, findings: Findings) {
	const siblings = layoutChildren(node).filter(inFlow);

	for (let i = 1; i < siblings.length; i++) {
		const later = siblings[i]!;

		for (let j = 0; j < i; j++) {
			const earlier = siblings[j]!;
			const overlap = intersection(earlier.box, later.box);

			if (overlap.x > OVERLAP_PX && overlap.y > OVERLAP_PX) {
				findings.add(
					later,
					"overlap",
					"warning",
					`${describe(later)} overlaps ${describe(earlier)} by ${Math.round(overlap.x)}×${Math.round(overlap.y)}px`,
				);

				break;
			}
		}
	}
}

/**
 * The backdrop behind `chain[0]`'s text: semi-transparent backgrounds composited over the first opaque one, or the
 * page. `null` when a gradient or image is on the way, since its color under the text is unknown.
 */
function backdropOf(chain: LayoutNode[]): { color: Rgba; opacity: number } | null {
	const layers: Rgba[] = [];
	let opacity = 1;
	let base = PAGE_BACKGROUND;

	for (const node of chain) {
		if (node.hasBackgroundImage) return null;

		if (node.background && node.background.a >= 1) {
			base = node.background;

			break;
		}

		// Opacity above the opaque backdrop fades the text into it; the backdrop's own opacity fades both alike
		opacity *= node.opacity;

		if (hasPaint(node.background)) layers.push(node.background!);
	}

	const color = layers.reduceRight((under, layer) => composite(layer, under), base);

	return { color, opacity };
}

/** `ancestors` is innermost first */
function checkContrast(node: LayoutNode, ancestors: LayoutNode[], findings: Findings) {
	if (!node.ownText || !hasPaint(node.color)) return;
	const backdrop = backdropOf([node, ...ancestors]);

	if (!backdrop) return;
	const text = composite({ ...node.color!, a: node.color!.a * backdrop.opacity }, backdrop.color);
	const ratio = contrastRatio(text, backdrop.color);
	const large = isLargeText(node);
	const shown = `${ratio.toFixed(2)}:1`;

	if (ratio < MIN_CONTRAST)
		findings.add(node, "contrast", "error", `${describe(node)} has a contrast of ${shown}, under ${MIN_CONTRAST}:1`);
	else if (!large && ratio < MIN_TEXT_CONTRAST)
		findings.add(
			node,
			"contrast",
			"warning",
			`${describe(node)} has a contrast of ${shown}, under ${MIN_TEXT_CONTRAST}:1 for text this size`,
		);
}

const isContainer = (node: LayoutNode) => /^(inline-)?(flex|grid)$/.test(node.display);

function checkEmptyContainer(node: LayoutNode, findings: Findings) {
	if (
		!isContainer(node) ||
		node.children.length ||
		node.ownText ||
		hasPaint(node.background) ||
		node.hasBackgroundImage ||
		node.hasBorder ||
		node.box.height <= EMPTY_CONTAINER_MIN_HEIGHT
	)
		return;

	findings.add(
		node,
		"empty-container",
		"warning",
		`<${node.tag}> is an empty ${node.display} box ${Math.round(node.box.height)}px tall. A list rendering nothing, or a leftover?`,
	);
}

/** Half pixels apart are the same size to the eye */
const sizeKey = (size: number) => Math.round(size * 2) / 2;

const isCard = (node: LayoutNode, frame: { width: number }) =>
	(node.hasBorder || hasPaint(node.background)) && node.box.width < frame.width - TOLERANCE_PX;

/** Sizes of the text inside `node`, not counting nested cards, which are checked on their own */
function cardFontSizes(node: LayoutNode, frame: { width: number }, sizes: Set<number>) {
	if (node.ownText) sizes.add(sizeKey(node.fontSize));

	for (const child of node.children) if (!isCard(child, frame)) cardFontSizes(child, frame, sizes);
}

const pixels = (sizes: Iterable<number>) => [...sizes].sort((a, b) => a - b).map((size) => `${size}px`);

function checkFontSizes(nodes: LayoutNode[], root: LayoutNode, frame: { width: number }, findings: Findings) {
	const screen = new Set<number>();

	for (const node of nodes) {
		if (node.ownText) screen.add(sizeKey(node.fontSize));

		if (!isCard(node, frame)) continue;
		const sizes = new Set<number>();
		cardFontSizes(node, frame, sizes);

		if (sizes.size > MAX_CARD_FONT_SIZES)
			findings.add(
				node,
				"font-sizes",
				"warning",
				`<${node.tag}> mixes ${sizes.size} font sizes (${pixels(sizes).join(", ")}). Keep a card to ${MAX_CARD_FONT_SIZES}`,
			);
	}

	if (screen.size > MAX_SCREEN_FONT_SIZES)
		findings.add(
			root,
			"font-sizes",
			"warning",
			`The screen uses ${screen.size} font sizes (${pixels(screen).join(", ")}). Keep to ${MAX_SCREEN_FONT_SIZES} or fewer for a clear scale`,
		);
}

/** Layout checks on a rendered screen. `frame` is its viewport in CSS pixels. */
export function layoutFindings(root: LayoutNode, frame: { width: number; height: number }): LayoutFinding[] {
	const findings = new Findings();
	const nodes: LayoutNode[] = [];

	const visit = (node: LayoutNode, ancestors: LayoutNode[]) => {
		nodes.push(node);
		checkClippedText(node, findings);
		checkOverlap(node, findings);
		checkContrast(node, ancestors, findings);
		checkEmptyContainer(node, findings);
		const inner = [node, ...ancestors];

		for (const child of node.children) visit(child, inner);
	};

	visit(root, []);
	checkOverflow(root, frame.width, frame.width, findings);
	checkFontSizes(nodes, root, frame, findings);

	return findings.list;
}
