import { describe, expect, test } from "bun:test";
import { readConstraint, setConstraint } from "./constraints";

describe("constraints", () => {
	test("reads the pinned sides", () => {
		expect(readConstraint("absolute top-4 left-4", "x")).toBe("start");
		expect(readConstraint("absolute right-2", "x")).toBe("end");
		expect(readConstraint("absolute inset-x-0", "x")).toBe("both");
		expect(readConstraint("absolute inset-0", "y")).toBe("both");
		expect(readConstraint("absolute left-1/2 -translate-x-1/2", "x")).toBe("center");
		expect(readConstraint("absolute left-1/2", "x")).toBe("start");
		expect(readConstraint("absolute", "y")).toBeNull();
	});

	test("pins a side and keeps the offset it had", () => {
		expect(setConstraint("absolute left-4 top-2", "x", "end")).toBe("absolute top-2 right-0");
		expect(setConstraint("absolute left-4 top-2", "x", "both")).toBe("absolute top-2 right-0 left-4");
		expect(setConstraint("absolute inset-x-6", "x", "start")).toBe("absolute left-6");
		expect(setConstraint("absolute bottom-3", "y", "both")).toBe("absolute top-0 bottom-3");
	});

	test("centering adds the translate and removing it drops it", () => {
		const centered = setConstraint("absolute left-4 top-2", "x", "center");

		expect(centered).toBe("absolute top-2 left-1/2 -translate-x-1/2");
		expect(readConstraint(centered, "x")).toBe("center");
		expect(setConstraint(centered, "x", "start")).toBe("absolute top-2 left-0");
		expect(setConstraint(centered, "x", null)).toBe("absolute top-2");
	});

	test("writes the classes of a state", () => {
		expect(setConstraint("absolute left-4", "x", "end", "md")).toBe("absolute left-4 md:right-0");
		expect(setConstraint("absolute", "y", "center", "md")).toBe("absolute md:top-1/2 md:-translate-y-1/2");
	});
});
