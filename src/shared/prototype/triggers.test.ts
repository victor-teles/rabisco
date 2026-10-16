import { describe, expect, test } from "bun:test";
import { CLICK, formatTrigger, matchesKey, parseTrigger, triggerLabel } from "./triggers";

describe("link triggers", () => {
	test("parses each trigger and treats anything else as a click", () => {
		expect(parseTrigger("Hover")).toEqual({ kind: "hover" });
		expect(parseTrigger(" press ")).toEqual({ kind: "press" });
		expect(parseTrigger("after 800ms")).toEqual({ kind: "after", ms: 800 });
		expect(parseTrigger("after 1.5s")).toEqual({ kind: "after", ms: 1500 });
		expect(parseTrigger("key Enter")).toEqual({ kind: "key", key: "Enter" });
		expect(parseTrigger("key K")).toEqual({ kind: "key", key: "k" });
		expect(parseTrigger("key space")).toEqual({ kind: "key", key: " " });

		for (const value of [null, "", "click", "swipe", "after", "after soon", "after 9000ms", "key"])
			expect(parseTrigger(value)).toEqual(CLICK);
	});

	test("formats back to what it parses", () => {
		for (const value of ["hover", "press", "after 800ms", "key Enter", "key Space", "key k"])
			expect(formatTrigger(parseTrigger(value))).toBe(value);
		expect(formatTrigger(CLICK)).toBeNull();
	});

	test("matches keys and labels triggers", () => {
		expect(matchesKey(parseTrigger("key k"), "K")).toBe(true);
		expect(matchesKey(parseTrigger("key ArrowRight"), "ArrowRight")).toBe(true);
		expect(matchesKey(parseTrigger("key Enter"), "Escape")).toBe(false);
		expect(triggerLabel(parseTrigger("key ArrowRight"))).toBe("Key →");
		expect(triggerLabel(parseTrigger("after 800ms"))).toBe("After 800 ms");
	});
});
