import type { MotionKeyframe, OverlayMotion, ScreenTransition } from "./transitions";

export const TWEEN_FRAME_MS = 40;

export const MIN_HOLD_MS = 700;

export const MAX_HOLD_MS = 4_000;

export const LAST_HOLD_MS = 2_000;

export type StepMotion =
	| { kind: "screen"; plan: ScreenTransition }
	| { kind: "overlay"; motion: OverlayMotion; opening: boolean };

export type WalkthroughStep = { at: number; motion: StepMotion | null };

export type WalkthroughFrame = { step: number; progress: number | null; delay: number };

const durationOf = (motion: StepMotion | null) =>
	!motion ? 0 : motion.kind === "screen" ? motion.plan.duration : motion.motion.duration;

const easingOf = (motion: StepMotion) => (motion.kind === "screen" ? motion.plan.easing : motion.motion.easing);

export function walkthroughFrames(steps: WalkthroughStep[]): WalkthroughFrame[] {
	const frames: WalkthroughFrame[] = [];

	steps.forEach((step, i) => {
		const { motion } = step;

		if (motion && i > 0) {
			const count = Math.max(2, Math.round(durationOf(motion) / TWEEN_FRAME_MS));
			const ease = easing(easingOf(motion));

			for (let j = 1; j < count; j++) frames.push({ step: i, progress: ease(j / count), delay: TWEEN_FRAME_MS });
		}

		const next = steps[i + 1];

		const hold = next
			? Math.min(MAX_HOLD_MS, Math.max(MIN_HOLD_MS, next.at - step.at - durationOf(next.motion)))
			: LAST_HOLD_MS;

		frames.push({ step: i, progress: null, delay: hold });
	});

	return frames;
}

const BEZIER = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/;

const NAMED = new Map<string, number[]>([
	["ease", [0.25, 0.1, 0.25, 1]],
	["ease-in", [0.42, 0, 1, 1]],
	["ease-out", [0, 0, 0.58, 1]],
	["ease-in-out", [0.42, 0, 0.58, 1]],
]);

function bezier(x1: number, y1: number, x2: number, y2: number) {
	const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;

	return (x: number) => {
		let low = 0;
		let high = 1;

		for (let i = 0; i < 30; i++) {
			const mid = (low + high) / 2;

			if (at(x1, x2, mid) < x) low = mid;
			else high = mid;
		}

		return at(y1, y2, (low + high) / 2);
	};
}

export function easing(css: string): (t: number) => number {
	const match = BEZIER.exec(css.trim());
	const points = match ? [match[1], match[2], match[3], match[4]].map(Number) : NAMED.get(css.trim());

	if (!points || points.some((n) => !Number.isFinite(n))) return (t) => t;
	const [x1, y1, x2, y2] = points;
	const curve = bezier(x1!, y1!, x2!, y2!);

	return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : curve(t));
}

export type Pose = { opacity: number; x: number; y: number };

const TRANSLATE = /translate([XY])\(\s*(-?[\d.]+)%\s*\)/g;

function poseOf(keyframe: MotionKeyframe): Pose {
	const pose = { opacity: keyframe.opacity ?? 1, x: 0, y: 0 };

	for (const [, axis, value] of (keyframe.transform ?? "").matchAll(TRANSLATE)) {
		if (axis === "X") pose.x = Number(value) / 100;
		else pose.y = Number(value) / 100;
	}

	return pose;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function poseAt(keyframes: MotionKeyframe[], progress: number): Pose {
	if (!keyframes.length) return { opacity: 1, x: 0, y: 0 };

	if (keyframes.length === 1) return poseOf(keyframes[0]!);
	const scaled = Math.min(1, Math.max(0, progress)) * (keyframes.length - 1);
	const at = Math.min(keyframes.length - 2, Math.floor(scaled));
	const from = poseOf(keyframes[at]!);
	const to = poseOf(keyframes[at + 1]!);
	const t = scaled - at;

	return { opacity: mix(from.opacity, to.opacity, t), x: mix(from.x, to.x, t), y: mix(from.y, to.y, t) };
}

export function walkthroughFileName(slug: string) {
	return `${slug}-walkthrough.gif`;
}
