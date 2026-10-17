import { describe, expect, test } from "bun:test";
import { rulerTicks } from "./rulers";

describe("rulerTicks", () => {
	test("labels a step that leaves room, with minor ticks between", () => {
		const ticks = rulerTicks(0, 1, 200);
		const majors = ticks.flatMap((tick) => (tick.major ? [tick.value] : []));

		expect(majors).toEqual([0, 100, 200]);
		expect(ticks.filter((tick) => !tick.major)).toHaveLength(8);
	});

	test("steps grow as the canvas zooms out", () => {
		const majors = rulerTicks(0, 0.1, 400).flatMap((tick) => (tick.major ? [tick.value] : []));

		expect(majors).toEqual([0, 1000, 2000, 3000, 4000]);
	});

	test("values count from the origin, negative before it", () => {
		const ticks = rulerTicks(150, 2, 300);
		const majors = ticks.flatMap((tick) => (tick.major ? [[tick.value, tick.position]] : []));

		expect(majors).toEqual([
			[-50, 50],
			[0, 150],
			[50, 250],
		]);
	});

	test("nothing for an empty ruler", () => {
		expect(rulerTicks(0, 1, 0)).toEqual([]);
		expect(rulerTicks(0, 0, 100)).toEqual([]);
	});
});
