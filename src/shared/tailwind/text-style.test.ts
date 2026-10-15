import { describe, expect, test } from "bun:test";
import { setCustomTokens } from "./classes";
import { applyTextStyle, detachTextStyle } from "./text-style";

describe("text styles", () => {
	setCustomTokens(["text-heading"]);

	test("applying one replaces the size, line height, weight and tracking", () => {
		expect(applyTextStyle("p-4 text-lg font-bold leading-6 tracking-tight", "heading")).toBe("p-4 text-heading");
		expect(applyTextStyle("text-sm md:text-lg md:font-bold", "heading", "md")).toBe("text-sm md:text-heading");
	});

	test("detaching writes its values as the element's classes", () => {
		expect(detachTextStyle("p-4 text-heading", "2rem/1.2 bold -0.01em")).toBe(
			"p-4 text-[2rem]/[1.2] font-[700] tracking-[-0.01em]",
		);
		expect(detachTextStyle("text-heading", "1rem")).toBe("text-[1rem]");
	});
});
