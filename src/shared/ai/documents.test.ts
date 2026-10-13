import { describe, expect, test } from "bun:test";
import { CUT_NOTE, DOCUMENT_LIMITS, isDocumentFile, parseDocuments, promptDocument } from "./documents";

describe("documents", () => {
	test("Markdown and text files are documents, by type or by name", () => {
		expect(isDocumentFile({ name: "prd.md", type: "" })).toBe(true);
		expect(isDocumentFile({ name: "Spec.MARKDOWN", type: "" })).toBe(true);
		expect(isDocumentFile({ name: "notes", type: "text/plain" })).toBe(true);
		expect(isDocumentFile({ name: "shot.png", type: "image/png" })).toBe(false);
		expect(isDocumentFile({ name: "spec.pdf", type: "application/pdf" })).toBe(false);
	});

	test("a document is trimmed, an empty one is dropped and a long one is cut", () => {
		expect(promptDocument("a.md", "\r\n# A\r\n\r\nText  \n")).toEqual({ name: "a.md", content: "# A\n\nText" });
		expect(promptDocument("empty.md", " \n ")).toBeNull();

		const long = promptDocument("long.md", "x".repeat(DOCUMENT_LIMITS.chars + 10))!;
		expect(long.content.endsWith(CUT_NOTE)).toBe(true);
		expect(long.content.length).toBe(DOCUMENT_LIMITS.chars + CUT_NOTE.length);
	});

	test("stored documents parse back; malformed ones are dropped", () => {
		expect(parseDocuments([{ name: "a.md", content: "A" }, { name: 1, content: "B" }, "c"])).toEqual([
			{ name: "a.md", content: "A" },
		]);
		expect(parseDocuments(undefined)).toEqual([]);
	});
});
