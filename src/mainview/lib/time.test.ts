import { describe, expect, test } from "bun:test";
import { formatWhen } from "./time";

const now = new Date(2026, 9, 7, 12, 0, 0).getTime();

const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

describe("formatWhen", () => {
	test("relative within a week", () => {
		expect(formatWhen(ago(10), now)).toBe("just now");
		expect(formatWhen(ago(5 * 60), now)).toBe("5 minutes ago");
		expect(formatWhen(ago(3 * 3600), now)).toBe("3 hours ago");
		expect(formatWhen(ago(86400), now)).toBe("yesterday");
		expect(formatWhen(ago(6 * 86400), now)).toBe("6 days ago");
	});

	test("the date after a week", () => {
		expect(formatWhen(new Date(2026, 8, 20, 9).toISOString(), now)).toBe("Sep 20");
	});

	test("the year when it isn't this year", () => {
		expect(formatWhen(new Date(2025, 11, 31, 9).toISOString(), now)).toBe("Dec 31, 2025");
	});

	test("nothing for a missing date", () => {
		expect(formatWhen("", now)).toBe("");
	});
});
