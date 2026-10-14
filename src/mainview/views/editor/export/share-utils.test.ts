import { describe, expect, test } from "bun:test";
import { expiryDay, expiryFromDate } from "./share-utils";

describe("expiry dates", () => {
	test("the link works through the picked day and stops at the next local midnight", () => {
		const expiresAt = expiryFromDate("2026-10-20");

		expect(new Date(expiresAt).getTime()).toBe(new Date(2026, 9, 21).getTime());
		expect(expiryDay(expiresAt)).toBe("2026-10-20");
	});

	test("the picked day can be the last day of a month", () => {
		expect(expiryDay(expiryFromDate("2026-10-31"))).toBe("2026-10-31");
		expect(new Date(expiryFromDate("2026-10-31")).getDate()).toBe(1);
	});
});
