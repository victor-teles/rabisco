import { describe, expect, test } from "bun:test";
import { addUsage, parseUsage, totalUsage, usageLabel } from "./usage";

describe("usage", () => {
	test("sums what each run reported, keeping parts nobody reported missing", () => {
		expect(addUsage({ inputTokens: 10 }, { inputTokens: 5, outputTokens: 2 })).toEqual({
			inputTokens: 15,
			outputTokens: 2,
			costUsd: undefined,
		});
		expect(totalUsage([undefined, { costUsd: 0.5 }, undefined, { costUsd: 0.25 }])?.costUsd).toBe(0.75);
		expect(totalUsage([undefined])).toBeUndefined();
	});

	test("parses stored usage, dropping anything that isn't a count", () => {
		expect(parseUsage({ inputTokens: 12, outputTokens: -1, costUsd: "1" })).toEqual({ inputTokens: 12 });
		expect(parseUsage({ inputTokens: null })).toBeUndefined();
		expect(parseUsage("12")).toBeUndefined();
	});

	test("labels tokens and cost, leaving out what wasn't reported", () => {
		expect(usageLabel({ inputTokens: 11_000, outputTokens: 1_400, costUsd: 0.084 })).toBe("12.4K tokens · $0.08");
		expect(usageLabel({ inputTokens: 900, outputTokens: 0 })).toBe("900 tokens");
		expect(usageLabel({ costUsd: 0.004 })).toBe("<$0.01");
		expect(usageLabel({ inputTokens: 0, outputTokens: 0, costUsd: 0 })).toBe("");
		expect(usageLabel(undefined)).toBe("");
	});
});
