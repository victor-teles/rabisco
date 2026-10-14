// The share viewer's inspect and comment modes (decision 0038). The frame takes the taps itself, so the screen still
// scrolls under a finger, and draws its marks in its own viewport.
import { COLOR_TOKENS } from "../../shared/context/tokens";
import { isVisible, parseColor, toHex, type Rgba } from "../../shared/export/color";
import { GAP_FILL, INSPECT_ACCENT, PADDING_FILL } from "../../shared/share/marks";
import {
	resolveHit,
	type Box,
	type FrameMessage,
	type InspectedColor,
	type InspectedElement,
	type PickMode,
} from "../lib/render/protocol";
import type { Insets } from "../lib/render/spacing";
import { boxOf, locatedAt, spacingOf } from "./inspect";

const ACCENT = INSPECT_ACCENT;

const MARKS_ATTRIBUTE = "data-rabisco-marks";

const SEMANTIC: readonly string[] = COLOR_TOKENS;

type Token = { name: string; color: Rgba };

const sameRgb = (a: Rgba, b: Rgba) => a.r === b.r && a.g === b.g && a.b === b.b;

/** Semantic tokens, then custom ones, then the palette (`blue-500`) */
const rank = (name: string) => (SEMANTIC.includes(name) ? 0 : /-\d+$/.test(name) ? 2 : 1);

let tokens: { signature: string; list: Token[] } | null = null;

const SENTINEL = "rgb(1, 2, 3)";

function colorTokens(): Token[] {
	const styles = [...document.querySelectorAll("style")].map((style) => style.textContent ?? "");
	const signature = styles.map((css) => css.length).join(",");

	if (tokens?.signature === signature) return tokens.list;
	// `bg-primary` reads `--color-primary`, or `--primary` itself under shadcn's `@theme inline`
	const variables = new Map<string, string>();

	for (const css of styles) {
		for (const match of css.matchAll(/--([a-z][a-z0-9-]*)\s*:/gi)) {
			const variable = match[1]!;
			const name = variable.replace(/^color-/, "");

			if (!variable.startsWith("tw-") && !variables.has(name)) variables.set(name, variable);
		}
	}

	// A variable that isn't a color leaves the probe with the holder's color
	const holder = document.createElement("div");
	holder.style.cssText = `display:none;color:${SENTINEL}`;
	const probe = holder.appendChild(document.createElement("div"));
	document.documentElement.appendChild(holder);
	const list: Token[] = [];

	for (const [name, variable] of variables) {
		probe.style.color = `var(--${variable})`;
		const value = getComputedStyle(probe).color;
		const color = value === getComputedStyle(holder).color ? null : parseColor(value);

		if (color && color.a === 1) list.push({ name, color });
	}

	holder.remove();
	list.sort((a, b) => rank(a.name) - rank(b.name));
	tokens = { signature, list };

	return list;
}

/** A class that names the token wins a tie, so `bg-card` reads as `card` even when `background` has the same value */
function tokenFor(color: Rgba, classes: string[]): string | null {
	const matches = colorTokens().filter((token) => sameRgb(token.color, color));

	if (!matches.length) return null;

	const named =
		matches.find((token) =>
			classes.some((name) => name.endsWith(`-${token.name}`) || name.includes(`-${token.name}/`)),
		) ?? matches[0]!;

	return color.a < 1 ? `${named.name}/${Math.round(color.a * 100)}` : named.name;
}

const pixels = (value: string) => {
	const parsed = Number.parseFloat(value);

	return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : 0;
};

const insets = (style: CSSStyleDeclaration, prefix: "padding" | "margin"): Insets => ({
	top: pixels(style.getPropertyValue(`${prefix}-top`)),
	right: pixels(style.getPropertyValue(`${prefix}-right`)),
	bottom: pixels(style.getPropertyValue(`${prefix}-bottom`)),
	left: pixels(style.getPropertyValue(`${prefix}-left`)),
});

/** Typography belongs to the element that holds the text, not to every container above it */
const hasText = (element: Element) =>
	[...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim());

function colorsOf(element: Element, style: CSSStyleDeclaration): InspectedColor[] {
	const classes = (element.getAttribute("class") ?? "")
		.split(/\s+/)
		.map((name) => name.slice(name.lastIndexOf(":") + 1));

	const found: InspectedColor[] = [];

	const add = (role: InspectedColor["role"], value: string) => {
		const color = parseColor(value);

		if (!isVisible(color)) return;
		found.push({ role, hex: toHex(color), alpha: Math.round(color.a * 100) / 100, token: tokenFor(color, classes) });
	};

	if (element instanceof SVGElement && !(element instanceof SVGSVGElement)) {
		add("fill", style.fill);
		add("border", style.stroke);

		return found;
	}

	add("fill", style.backgroundColor);

	if (hasText(element) || element.querySelector(":scope > svg")) add("text", style.color);

	if (pixels(style.borderTopWidth) || pixels(style.borderLeftWidth)) add("border", style.borderTopColor);

	return found;
}

export function inspectElement(start: number, elements: Element[]): InspectedElement | null {
	const [element] = elements;
	const box = boxOf(elements);

	if (!element || !box) return null;
	const style = getComputedStyle(element);
	const laysOut = style.display.includes("flex") || style.display.includes("grid");
	const lineHeight = style.lineHeight === "normal" ? null : pixels(style.lineHeight);

	return {
		start,
		width: Math.round(box.width * 10) / 10,
		height: Math.round(box.height * 10) / 10,
		padding: insets(style, "padding"),
		margin: insets(style, "margin"),
		gap: laysOut ? { row: pixels(style.rowGap), column: pixels(style.columnGap) } : null,
		radius: [
			pixels(style.borderTopLeftRadius),
			pixels(style.borderTopRightRadius),
			pixels(style.borderBottomRightRadius),
			pixels(style.borderBottomLeftRadius),
		],
		font: hasText(element)
			? {
					family: style.fontFamily
						.split(",")[0]!
						.trim()
						.replace(/^["']|["']$/g, ""),
					size: pixels(style.fontSize),
					weight: style.fontWeight,
					lineHeight,
				}
			: null,
		colors: colorsOf(element, style),
		opacity: pixels(style.opacity),
	};
}

const MARKS_CSS = `[${MARKS_ATTRIBUTE}]{position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden}
[${MARKS_ATTRIBUTE}].cover{pointer-events:auto;cursor:default}
[${MARKS_ATTRIBUTE}].cover.point{cursor:crosshair}
[${MARKS_ATTRIBUTE}] div{position:absolute;box-sizing:border-box}
[${MARKS_ATTRIBUTE}] .size{transform:translateX(-50%);padding:1px 4px;border-radius:3px;background:${ACCENT};color:#fff;font:500 11px/16px ui-sans-serif,system-ui,sans-serif;white-space:nowrap}
[${MARKS_ATTRIBUTE}] .pin{width:32px;height:32px;margin:-32px 0 0 0;border-radius:16px 16px 16px 3px;background:${ACCENT};box-shadow:0 0 0 2px #fff,0 2px 6px rgb(0 0 0/.3)}`;

type Selected = { start: number; elements: Element[] };

const scrolls = (element: Element) => {
	const style = getComputedStyle(element);

	return (
		/auto|scroll/.test(style.overflowX + style.overflowY) &&
		(element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
	);
};

/** In a pick mode the marks cover the screen and take the pointer, so the screen shows no hover state and gets no
 * clicks or focus. Hit tests look under the cover */
export function createPickMode(entry: () => string, post: (message: FrameMessage) => void) {
	let mode: PickMode | null = null;
	let hovered: Selected | null = null;
	let selected: Selected | null = null;
	let pins: { x: number; y: number }[] = [];
	let frame = 0;
	const style = document.createElement("style");
	const marks = document.createElement("div");
	marks.setAttribute(MARKS_ATTRIBUTE, "");

	function under<T>(read: () => T): T {
		marks.style.pointerEvents = "none";

		try {
			return read();
		} finally {
			marks.style.pointerEvents = "";
		}
	}

	const at = (x: number, y: number): Selected | null => {
		const located = under(() => locatedAt(x, y));

		const hit = resolveHit(
			located.map((item) => item.loc),
			entry(),
		);

		const index = hit?.indices[0];

		return hit && index !== undefined ? { start: hit.starts[0]!, elements: located[index]!.elements } : null;
	};

	const scrollerAt = (x: number, y: number) => {
		for (let element = under(() => document.elementFromPoint(x, y)); element; element = element.parentElement)
			if (scrolls(element)) return element;

		return document.scrollingElement;
	};

	const mark = (css: string, className = "") => {
		const element = document.createElement("div");
		element.className = className;
		element.style.cssText = css;

		return marks.appendChild(element);
	};

	const rect = (box: Box, css: string) =>
		mark(`left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;${css}`);

	const draw = () => {
		frame = 0;
		marks.replaceChildren();

		for (const pin of pins) mark(`left:${pin.x - window.scrollX}px;top:${pin.y - window.scrollY}px`, "pin");

		if (selected && !selected.elements.every((element) => element.isConnected)) {
			selected = null;
			post({ type: "inspected", element: null });
		}

		if (hovered && hovered.start !== selected?.start) {
			const box = boxOf(hovered.elements);

			if (box) rect(box, `border:1px solid ${ACCENT}`);
		}

		if (!selected) return;
		const box = boxOf(selected.elements);

		if (!box) return;
		const spacing = spacingOf(selected.elements);

		for (const padding of spacing?.padding ?? []) rect(padding, `background:${PADDING_FILL}`);

		for (const gap of spacing?.gaps ?? []) rect(gap, `background:${GAP_FILL}`);
		rect(box, `border:1.5px solid ${ACCENT}`);
		const below = box.y + box.height + 22 <= window.innerHeight;
		const top = below ? box.y + box.height + 4 : Math.max(0, box.y - 20);
		const label = mark(`left:${box.x + box.width / 2}px;top:${top}px`, "size");
		label.textContent = `${Math.round(box.width * 10) / 10} × ${Math.round(box.height * 10) / 10}`;
	};

	const redraw = () => {
		if (!frame) frame = requestAnimationFrame(draw);
	};

	const select = (next: Selected | null) => {
		selected = next;
		post({ type: "inspected", element: next && inspectElement(next.start, next.elements) });
		redraw();
	};

	marks.addEventListener("click", (event) => {
		if (mode === "inspect") select(at(event.clientX, event.clientY));
		else if (mode === "point")
			post({
				type: "pointed",
				x: event.clientX + window.scrollX,
				y: event.clientY + window.scrollY,
				clientX: event.clientX,
				clientY: event.clientY,
			});
	});
	marks.addEventListener("pointermove", (event) => {
		if (mode !== "inspect" || event.pointerType === "touch") return;
		const next = at(event.clientX, event.clientY);

		if (next?.start === hovered?.start) return;
		hovered = next;
		redraw();
	});
	marks.addEventListener("pointerleave", () => {
		hovered = null;
		redraw();
	});
	// The cover would stop the wheel from reaching the screen's own scroll areas
	marks.addEventListener(
		"wheel",
		(event) => {
			event.preventDefault();
			scrollerAt(event.clientX, event.clientY)?.scrollBy(event.deltaX, event.deltaY);
		},
		{ passive: false },
	);
	window.addEventListener(
		"keydown",
		(event) => {
			if (mode && event.key === "Escape") post({ type: "escape" });
		},
		true,
	);
	window.addEventListener("scroll", redraw, { capture: true, passive: true });
	window.addEventListener("resize", redraw);

	const sync = () => {
		if (!mode && !pins.length) {
			style.remove();
			marks.remove();

			return;
		}

		marks.className = mode ? `cover ${mode}` : "";
		style.textContent = MARKS_CSS;

		if (!style.isConnected) document.head.appendChild(style);

		if (!marks.isConnected) document.documentElement.appendChild(marks);
		redraw();
	};

	return {
		get mode() {
			return mode;
		},
		set(next: PickMode | null) {
			mode = next;
			hovered = null;
			selected = null;
			sync();
		},
		pins(next: { x: number; y: number }[]) {
			pins = next;
			sync();
		},
		redraw,
	};
}
