import { describe, expect, test } from "bun:test";
import { labelLimits } from "./label-collisions";

const frame = (file: string, x: number, y: number) => ({ file, name: file, x, y, width: 390, height: 844 });

const section = { name: "Section 1", x: 0, y: 0, width: 2000, height: 2000 };

const measure = (name: string) => name.length * 10;

describe("labelLimits", () => {
	test("a screen alone keeps its name at every zoom", () => {
		expect(labelLimits([frame("Today", 0, 0)], [], measure).size).toBe(0);
	});

	test("a name hides once the gap to the screen above is shorter than the label", () => {
		const limits = labelLimits([frame("Detail", 0, 0), frame("Reminders", 0, 944)], [], measure);

		expect(limits.get("Reminders")).toBe(0.2);
		expect(limits.has("Detail")).toBe(false);
	});

	test("a screen above and to the right covers the name only as far as the name reaches", () => {
		const limits = labelLimits([frame("Above", 200, 0), frame("Reminders", 0, 944)], [], measure);

		expect(limits.get("Reminders")).toBe(0.2);
		expect(labelLimits([frame("Far", 400, 0), frame("Reminders", 0, 944)], [], measure).size).toBe(0);
	});

	test("screens side by side don't hide each other's names", () => {
		expect(labelLimits([frame("Today", 0, 0), frame("Stats", 490, 0)], [], measure).size).toBe(0);
	});

	test("the first screen in a section hides its name under the section's name", () => {
		const limits = labelLimits([frame("Today", 100, 100)], [section], measure);

		expect(limits.get("Today")).toBeCloseTo(0.52);
	});

	test("a screen far from the section's corner keeps its name down to a lower zoom", () => {
		const limits = labelLimits([frame("Stats", 1200, 100)], [section], measure);

		expect(limits.get("Stats")).toBeCloseTo(0.095);
	});

	test("a section elsewhere has no effect", () => {
		expect(labelLimits([frame("Today", 100, 100)], [{ ...section, x: 3000 }], measure).size).toBe(0);
	});
});
