export const LINK_TRANSITION_ATTRIBUTE = "data-link-transition";

export const LINK_MODE_ATTRIBUTE = "data-link-mode";

export const TRANSITIONS = ["instant", "dissolve", "slide", "push"] as const;

export type LinkTransition = (typeof TRANSITIONS)[number];

export const OVERLAY_MODES = ["overlay", "sheet"] as const;

export type OverlayMode = (typeof OVERLAY_MODES)[number];

export type Direction = "forward" | "back";

export type MotionKeyframe = { opacity?: number; transform?: string };

export type Motion = { duration: number; easing: string };

export type ScreenTransition = Motion & {
	incoming: MotionKeyframe[];
	outgoing: MotionKeyframe[];
	top: "incoming" | "outgoing";
};

export type OverlayMotion = Motion & { panel: MotionKeyframe[]; backdrop: MotionKeyframe[] };

export type Size = { width: number; height: number };

export type Rect = Size & { x: number; y: number };

export const TRANSITION_MS = 300;

export const TRANSITION_EASING = "cubic-bezier(0.2, 0, 0, 1)";

const MOTION: Motion = { duration: TRANSITION_MS, easing: TRANSITION_EASING };

const isTransition = (value: string): value is LinkTransition => TRANSITIONS.some((name) => name === value);

export function parseTransition(value: string | null | undefined): LinkTransition | null {
	const name = value?.trim().toLowerCase();

	return name && isTransition(name) ? name : null;
}

export function parseOverlayMode(value: string | null | undefined): OverlayMode | null {
	const name = value?.trim().toLowerCase();

	if (name === "overlay" || name === "modal") return "overlay";

	return name === "sheet" ? "sheet" : null;
}

const FADE_IN: MotionKeyframe[] = [{ opacity: 0 }, { opacity: 1 }];

const FADE_OUT: MotionKeyframe[] = [{ opacity: 1 }, { opacity: 0 }];

const slideX = (from: number, to: number): MotionKeyframe[] => [
	{ transform: `translateX(${from}%)` },
	{ transform: `translateX(${to}%)` },
];

export function screenTransition(
	transition: LinkTransition,
	direction: Direction,
	reducedMotion: boolean,
): ScreenTransition | null {
	if (transition === "instant") return null;

	if (transition === "dissolve" || reducedMotion)
		return { ...MOTION, incoming: FADE_IN, outgoing: [], top: "incoming" };

	const forward = direction === "forward";

	if (transition === "slide")
		return forward
			? { ...MOTION, incoming: slideX(100, 0), outgoing: [], top: "incoming" }
			: { ...MOTION, incoming: [], outgoing: slideX(0, 100), top: "outgoing" };

	return forward
		? { ...MOTION, incoming: slideX(100, 0), outgoing: slideX(0, -100), top: "incoming" }
		: { ...MOTION, incoming: slideX(-100, 0), outgoing: slideX(0, 100), top: "outgoing" };
}

export const defaultOverlayTransition = (mode: OverlayMode): LinkTransition =>
	mode === "sheet" ? "slide" : "dissolve";

export function overlayMotion(
	mode: OverlayMode,
	transition: LinkTransition | null,
	opening: boolean,
	reducedMotion: boolean,
): OverlayMotion | null {
	const chosen = transition ?? defaultOverlayTransition(mode);

	if (chosen === "instant") return null;

	const panel: MotionKeyframe[] =
		chosen === "dissolve" || reducedMotion
			? FADE_IN
			: [{ transform: "translateY(100%)" }, { transform: "translateY(0%)" }];

	return opening
		? { ...MOTION, panel, backdrop: FADE_IN }
		: { ...MOTION, panel: [...panel].reverse(), backdrop: FADE_OUT };
}

export function overlayRect(mode: OverlayMode, screen: Size, overlay: Size): Rect {
	const height = Math.min(overlay.height, screen.height);

	if (mode === "sheet") return { x: 0, y: screen.height - height, width: screen.width, height };
	const width = Math.min(overlay.width, screen.width);

	return { x: (screen.width - width) / 2, y: (screen.height - height) / 2, width, height };
}
