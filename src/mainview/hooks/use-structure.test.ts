import { describe, expect, test } from "bun:test";
import { madeComponentMessage } from "./use-structure";

describe("madeComponentMessage", () => {
	test("counts replacements across files", () => {
		expect(
			madeComponentMessage("StatCard", [
				{ path: "screens/a.tsx", count: 3 },
				{ path: "screens/b.tsx", count: 1 },
			]),
		).toBe("Made StatCard · replaced 4 in 2 files");
		expect(madeComponentMessage("Row", [{ path: "screens/a.tsx", count: 2 }])).toBe("Made Row · replaced 2 in 1 file");
		expect(madeComponentMessage("Hero", [{ path: "screens/a.tsx", count: 1 }])).toBe("Made Hero");
	});
});
