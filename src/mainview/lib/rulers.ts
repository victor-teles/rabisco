/** Canvas units between labeled ticks: the first that leaves room for a label */
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

/** In pixels */
const MIN_GAP = 56;

export type RulerTick = { position: number; value: number; major: boolean };

/**
 * The ticks of a ruler `length` pixels long. `origin` is where 0 sits in pixels along the ruler, and `zoom` scales
 * canvas units to pixels. Minor ticks fall every fifth (or half) of a step.
 */
export function rulerTicks(origin: number, zoom: number, length: number): RulerTick[] {
	if (!(zoom > 0) || !(length > 0)) return [];
	const step = STEPS.find((s) => s * zoom >= MIN_GAP) ?? STEPS[STEPS.length - 1]!;
	const minor = step / (String(step).startsWith("2") ? 4 : 5);
	const first = Math.ceil(-origin / zoom / minor);
	const last = Math.floor((length - origin) / zoom / minor);
	const ticks: RulerTick[] = [];

	for (let i = first; i <= last; i++) {
		const value = Math.round(i * minor * 1000) / 1000 || 0;

		ticks.push({ position: origin + value * zoom, value, major: Math.abs(value % step) < 1e-6 });
	}

	return ticks;
}
