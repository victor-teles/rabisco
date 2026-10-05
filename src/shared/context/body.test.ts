import { describe, expect, test } from "bun:test";
import { contextBody } from "./body";

describe("contextBody", () => {
	test("missing or blank files have no body", () => {
		expect(contextBody(undefined)).toBeUndefined();
		expect(contextBody("")).toBeUndefined();
		expect(contextBody("  \n\n ")).toBeUndefined();
	});

	test("an untouched template (headings and comments only) has no body", () => {
		const template = `# Product

<!--
What is it, in one or two sentences?
-->

## Audience
<!-- Who is it for? -->

## Voice

### Do / Don't
`;
		expect(contextBody(template)).toBeUndefined();
	});

	test("strips comments, including multi-line and unterminated ones, and trims", () => {
		const file = `
# Product
<!-- guidance
over lines -->
A habit tracker for busy parents. <!-- inline -->


## Voice
Warm, short sentences.
<!-- never closed`;
		expect(contextBody(file)).toBe("# Product\n\nA habit tracker for busy parents.\n\n## Voice\nWarm, short sentences.");
	});

	test("any non-heading line counts as content", () => {
		expect(contextBody("## Tokens\n\n- primary: #ff0000")).toBe("## Tokens\n\n- primary: #ff0000");
		expect(contextBody("#hashtag is not a heading")).toBe("#hashtag is not a heading");
		expect(contextBody("Just prose")).toBe("Just prose");
	});
});
