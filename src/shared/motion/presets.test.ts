import { describe, expect, test } from "bun:test";
import {
	applyPreset,
	MOTION_KINDS,
	MOTION_PRESETS,
	presetClasses,
	presetsIn,
	readTiming,
	removePreset,
	setTiming,
} from "./presets";

const ids = (classes: string) => presetsIn(classes).map((preset) => preset.id);

describe("motion presets", () => {
	test("every kind has presets, and ids are unique", () => {
		for (const kind of MOTION_KINDS) expect(MOTION_PRESETS.some((preset) => preset.kind === kind)).toBe(true);
		expect(new Set(MOTION_PRESETS.map((preset) => preset.id)).size).toBe(MOTION_PRESETS.length);
	});

	test("each preset reads back as itself once applied", () => {
		for (const preset of MOTION_PRESETS) expect(ids(presetClasses(preset))).toEqual([preset.id]);
	});

	test("movement waits for motion-safe, so reduced motion only fades", () => {
		for (const preset of MOTION_PRESETS) {
			const moving = preset.classes.split(" ").filter((raw) => /(translate|scale|slide|zoom|bounce|spin)/.test(raw));

			for (const raw of moving) expect(raw.startsWith("motion-safe:")).toBe(true);
		}
	});

	test("applying adds the classes and the timing the element lacks", () => {
		expect(applyPreset("rounded-md p-4", "hover-lift")).toBe(
			"rounded-md p-4 transition motion-safe:hover:-translate-y-0.5 hover:shadow-md duration-200 ease-out",
		);
		expect(applyPreset("p-4 duration-500", "hover-grow")).toBe(
			"p-4 duration-500 transition motion-safe:hover:scale-105 ease-out",
		);
	});

	test("applying again changes nothing", () => {
		const once = applyPreset("p-4", "appear-rise");

		expect(applyPreset(once, "appear-rise")).toBe(once);
	});

	test("a preset replaces the one of the same kind and keeps the others", () => {
		const lifted = applyPreset(applyPreset("p-4", "hover-lift"), "press-shrink");
		const grown = applyPreset(lifted, "hover-grow");

		expect(ids(grown)).toEqual(["hover-grow", "press-shrink"]);
		expect(grown).not.toContain("hover:shadow-md");
		expect(grown).toContain("transition");
	});

	test("the most specific appear preset wins over Fade in", () => {
		expect(ids(applyPreset("", "appear-pop"))).toEqual(["appear-pop"]);
	});

	test("removing keeps shared classes another preset needs", () => {
		const both = applyPreset(applyPreset("p-4", "hover-dim"), "press-shrink");
		const pressed = removePreset(both, "hover-dim");

		expect(ids(pressed)).toEqual(["press-shrink"]);
		expect(pressed).toContain("transition");
		expect(pressed).toContain("duration-200");
	});

	test("removing the last preset drops the timing too", () => {
		expect(removePreset(applyPreset("p-4", "hover-lift"), "hover-lift")).toBe("p-4");
	});

	test("timing stays while another transition still uses it", () => {
		const classes = applyPreset("transition-colors duration-150 ease-in hover:bg-muted", "appear-fade");

		expect(removePreset(classes, "appear-fade")).toBe("transition-colors duration-150 ease-in hover:bg-muted");
	});

	test("timing reads and writes base classes only", () => {
		expect(readTiming("md:duration-700 duration-300 delay-100 ease-snappy")).toEqual({
			duration: "300",
			delay: "100",
			easing: "snappy",
		});
		expect(setTiming("p-4 duration-300 md:duration-700", "duration", "500")).toBe("p-4 duration-500 md:duration-700");
		expect(setTiming("p-4 delay-100", "delay", null)).toBe("p-4");
		expect(setTiming("p-4", "easing", "in-out")).toBe("p-4 ease-in-out");
	});
});
