// Motion presets are lists of Tailwind classes (decision 0027). Hover and press use `transition` with `hover:` and
// `active:`; appear and exit use tw-animate-css, which screens and the export already load. Movement sits behind
// `motion-safe:`, so with reduced motion an element only fades. Duration, delay and easing are plain classes the
// presets share, so an element has one timing whichever presets it has.

import { parseClass, splitClasses } from "../tailwind/classes";

export const MOTION_KINDS = ["hover", "press", "appear", "loop", "exit"] as const;

export type MotionKind = (typeof MOTION_KINDS)[number];

export const MOTION_KIND_LABELS: Record<MotionKind, string> = {
	hover: "Hover",
	press: "Press",
	appear: "Appear",
	loop: "Loop",
	exit: "Exit",
};

export const MOTION_KIND_HINTS: Record<MotionKind, string> = {
	hover: "Plays while the pointer is over the element",
	press: "Plays while the element is pressed",
	appear: "Plays once when the element first shows",
	loop: "Plays all the time, e.g. for a loading state",
	exit: 'Plays when a dialog, popover or menu closes (data-state="closed")',
};

export type MotionTiming = { duration: string | null; delay: string | null; easing: string | null };

export type MotionPreset = {
	id: string;
	kind: MotionKind;
	name: string;
	/** The classes that make the effect, without timing */
	classes: string;
	/** Added only for the parts the element has no class for */
	timing: MotionTiming;
};

const HOVER: MotionTiming = { duration: "200", delay: null, easing: "out" };

const PRESS: MotionTiming = { duration: "150", delay: null, easing: "out" };

const APPEAR: MotionTiming = { duration: "500", delay: null, easing: "out" };

const EXIT: MotionTiming = { duration: "200", delay: null, easing: "in" };

const NO_TIMING: MotionTiming = { duration: null, delay: null, easing: null };

// `fill-mode-backwards` hides an appearing element during its delay
const IN = "animate-in fade-in fill-mode-backwards";

const OUT = "data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

export const MOTION_PRESETS: readonly MotionPreset[] = [
	{
		id: "hover-lift",
		kind: "hover",
		name: "Lift",
		classes: "transition motion-safe:hover:-translate-y-0.5 hover:shadow-md",
		timing: HOVER,
	},
	{ id: "hover-grow", kind: "hover", name: "Grow", classes: "transition motion-safe:hover:scale-105", timing: HOVER },
	{ id: "hover-dim", kind: "hover", name: "Dim", classes: "transition hover:opacity-80", timing: HOVER },
	{
		id: "hover-glow",
		kind: "hover",
		name: "Glow",
		classes: "transition hover:ring-4 hover:ring-ring/30",
		timing: HOVER,
	},
	{
		id: "press-shrink",
		kind: "press",
		name: "Shrink",
		classes: "transition motion-safe:active:scale-95",
		timing: PRESS,
	},
	{
		id: "press-sink",
		kind: "press",
		name: "Sink",
		classes: "transition motion-safe:active:translate-y-px active:shadow-none",
		timing: PRESS,
	},
	{ id: "press-dim", kind: "press", name: "Dim", classes: "transition active:opacity-70", timing: PRESS },
	{ id: "appear-fade", kind: "appear", name: "Fade in", classes: IN, timing: APPEAR },
	{
		id: "appear-rise",
		kind: "appear",
		name: "Rise",
		classes: `${IN} motion-safe:slide-in-from-bottom-4`,
		timing: APPEAR,
	},
	{ id: "appear-drop", kind: "appear", name: "Drop", classes: `${IN} motion-safe:slide-in-from-top-4`, timing: APPEAR },
	{
		id: "appear-slide",
		kind: "appear",
		name: "Slide in",
		classes: `${IN} motion-safe:slide-in-from-left-4`,
		timing: APPEAR,
	},
	{ id: "appear-pop", kind: "appear", name: "Pop", classes: `${IN} motion-safe:zoom-in-95`, timing: APPEAR },
	{ id: "loop-pulse", kind: "loop", name: "Pulse", classes: "motion-safe:animate-pulse", timing: NO_TIMING },
	{ id: "loop-bounce", kind: "loop", name: "Bounce", classes: "motion-safe:animate-bounce", timing: NO_TIMING },
	{ id: "loop-spin", kind: "loop", name: "Spin", classes: "motion-safe:animate-spin", timing: NO_TIMING },
	{ id: "exit-fade", kind: "exit", name: "Fade out", classes: OUT, timing: EXIT },
	{
		id: "exit-shrink",
		kind: "exit",
		name: "Shrink out",
		classes: `${OUT} motion-safe:data-[state=closed]:zoom-out-95`,
		timing: EXIT,
	},
	{
		id: "exit-sink",
		kind: "exit",
		name: "Sink out",
		classes: `${OUT} motion-safe:data-[state=closed]:slide-out-to-bottom-4`,
		timing: EXIT,
	},
];

export const motionPreset = (id: string) => MOTION_PRESETS.find((preset) => preset.id === id) ?? null;

export const presetsOfKind = (kind: MotionKind) => MOTION_PRESETS.filter((preset) => preset.kind === kind);

export const TIMING_PARTS = ["duration", "delay", "easing"] as const;

export type TimingPart = (typeof TIMING_PARTS)[number];

const PREFIX: Record<TimingPart, string> = { duration: "duration-", delay: "delay-", easing: "ease-" };

/** The value of a timing class without variants: `duration-300` is `300`, `ease-snappy` is `snappy` */
function timingValue(raw: string, part: TimingPart): string | null {
	const parsed = parseClass(raw);

	if (parsed.variants.length || parsed.negative || parsed.important) return null;

	return parsed.utility.startsWith(PREFIX[part]) ? parsed.utility.slice(PREFIX[part].length) || null : null;
}

/** The last class wins, as in CSS order for one utility */
export function readTiming(classes: string): MotionTiming {
	const timing: MotionTiming = { ...NO_TIMING };

	for (const raw of splitClasses(classes)) {
		for (const part of TIMING_PARTS) {
			const value = timingValue(raw, part);

			if (value !== null) timing[part] = value;
		}
	}

	return timing;
}

/** Replaces the part's classes in place of the first; `null` removes them */
export function setTiming(classes: string, part: TimingPart, value: string | null): string {
	const list = splitClasses(classes);
	const index = list.findIndex((raw) => timingValue(raw, part) !== null);
	const kept = list.filter((raw) => timingValue(raw, part) === null);

	if (value === null) return kept.join(" ");
	const next = PREFIX[part] + value;

	if (index < 0) return [...kept, next].join(" ");
	kept.splice(index, 0, next);

	return kept.join(" ");
}

/** The presets an element has, one per kind: the one with the most classes when several match */
export function presetsIn(classes: string): MotionPreset[] {
	const own = new Set(splitClasses(classes));

	return MOTION_KINDS.flatMap((kind) => {
		let best: MotionPreset | null = null;

		for (const preset of presetsOfKind(kind)) {
			const parts = splitClasses(preset.classes);

			if (parts.every((raw) => own.has(raw)) && parts.length > (best ? splitClasses(best.classes).length : 0))
				best = preset;
		}

		return best ? [best] : [];
	});
}

/** A class anything still on the element animates with */
const isMotionClass = (raw: string) => {
	const { utility } = parseClass(raw);

	return utility === "transition" || utility.startsWith("transition-") || utility.startsWith("animate-");
};

/** Drops the preset's classes that no other preset on the element uses, and the timing once nothing moves */
export function removePreset(classes: string, id: string): string {
	const preset = motionPreset(id);

	if (!preset || !presetsIn(classes).some((own) => own.id === id)) return classes;
	const others = new Set(presetsIn(classes).flatMap((own) => (own.id === id ? [] : splitClasses(own.classes))));

	const dropped = new Set(splitClasses(preset.classes).filter((raw) => !others.has(raw)));

	let next = splitClasses(classes)
		.filter((raw) => !dropped.has(raw))
		.join(" ");

	if (splitClasses(next).some(isMotionClass)) return next;

	for (const part of TIMING_PARTS) next = setTiming(next, part, null);

	return next;
}

/** Replaces the element's preset of the same kind; timing classes it already has stay */
export function applyPreset(classes: string, id: string): string {
	const preset = motionPreset(id);

	if (!preset) return classes;
	const same = presetsIn(classes).find((own) => own.kind === preset.kind);
	let next = same && same.id !== id ? removePreset(classes, same.id) : classes;
	const own = new Set(splitClasses(next));
	const added = splitClasses(preset.classes).filter((raw) => !own.has(raw));

	next = [...splitClasses(next), ...added].join(" ");
	const timing = readTiming(next);

	for (const part of TIMING_PARTS) {
		const value = preset.timing[part];

		if (value !== null && timing[part] === null) next = setTiming(next, part, value);
	}

	return next;
}

/** The classes a preset adds to an element without classes, for previews and prompts */
export function presetClasses(preset: MotionPreset): string {
	return applyPreset("", preset.id);
}

export const DURATION_STEPS = ["75", "100", "150", "200", "300", "500", "700", "1000"] as const;

export const DELAY_STEPS = ["75", "100", "150", "200", "300", "500", "700", "1000"] as const;

export const EASING_STEPS = ["linear", "in", "out", "in-out"] as const;
