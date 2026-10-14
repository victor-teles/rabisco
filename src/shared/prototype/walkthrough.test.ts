import { describe, expect, test } from "bun:test";
import { overlayMotion, screenTransition, TRANSITION_EASING, TRANSITION_MS } from "./transitions";
import {
	easing,
	LAST_HOLD_MS,
	MAX_HOLD_MS,
	MIN_HOLD_MS,
	poseAt,
	TWEEN_FRAME_MS,
	walkthroughFrames,
} from "./walkthrough";

const push = screenTransition("push", "forward", false)!;

describe("walkthroughFrames", () => {
	test("holds each step for the time spent on it, kept between a glance and a pause", () => {
		const frames = walkthroughFrames([
			{ at: 0, motion: null },
			{ at: 100, motion: null },
			{ at: 2_100, motion: null },
			{ at: 60_000, motion: null },
		]);

		expect(frames).toEqual([
			{ step: 0, progress: null, delay: MIN_HOLD_MS },
			{ step: 1, progress: null, delay: 2_000 },
			{ step: 2, progress: null, delay: MAX_HOLD_MS },
			{ step: 3, progress: null, delay: LAST_HOLD_MS },
		]);
	});

	test("plays a step's motion as eased frames before its still, and takes the motion out of the hold before it", () => {
		const frames = walkthroughFrames([
			{ at: 0, motion: null },
			{ at: 1_800, motion: { kind: "screen", plan: push } },
		]);

		const tween = frames.slice(1, -1);

		expect(frames[0]).toEqual({ step: 0, progress: null, delay: 1_800 - TRANSITION_MS });
		expect(tween).toHaveLength(Math.round(TRANSITION_MS / TWEEN_FRAME_MS) - 1);
		expect(tween.every((f) => f.step === 1 && f.delay === TWEEN_FRAME_MS)).toBe(true);
		expect(tween.map((f) => f.progress)).toEqual(tween.map((f) => f.progress!).sort((a, b) => a - b));
		expect(tween[0]!.progress).toBeGreaterThan(0);
		expect(tween.at(-1)!.progress).toBeLessThan(1);
		expect(frames.at(-1)).toEqual({ step: 1, progress: null, delay: LAST_HOLD_MS });
	});

	test("ignores the motion of the first step", () => {
		const opening = overlayMotion("sheet", null, true, false)!;

		expect(walkthroughFrames([{ at: 0, motion: { kind: "overlay", motion: opening, opening: true } }])).toEqual([
			{ step: 0, progress: null, delay: LAST_HOLD_MS },
		]);
	});
});

describe("easing", () => {
	test("follows the transition curve: fast out, slow in", () => {
		const ease = easing(TRANSITION_EASING);

		expect(ease(0)).toBe(0);
		expect(ease(1)).toBe(1);
		expect(ease(0.5)).toBeGreaterThan(0.75);
	});

	test("treats unknown easings as linear and knows the named ones", () => {
		expect(easing("steps(4)")(0.3)).toBe(0.3);
		expect(easing("ease-in")(0.5)).toBeLessThan(0.5);
	});
});

describe("poseAt", () => {
	test("interpolates opacity and translates as shares of the layer's size", () => {
		expect(poseAt(push.incoming, 0)).toEqual({ opacity: 1, x: 1, y: 0 });
		expect(poseAt(push.incoming, 0.25)).toEqual({ opacity: 1, x: 0.75, y: 0 });
		expect(poseAt(push.outgoing, 1)).toEqual({ opacity: 1, x: -1, y: 0 });
		expect(poseAt([{ opacity: 0 }, { opacity: 1 }], 0.5).opacity).toBe(0.5);
		expect(poseAt([{ transform: "translateY(100%)" }, { transform: "translateY(0%)" }], 0.5).y).toBe(0.5);
	});

	test("leaves a layer with no keyframes in place", () => {
		expect(poseAt([], 0.4)).toEqual({ opacity: 1, x: 0, y: 0 });
	});
});
