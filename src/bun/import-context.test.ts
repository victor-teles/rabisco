import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { findContextFiles, MAX_CONTEXT_FILE_BYTES } from "./import-context";
import { tempDir } from "./test-utils";

function repo(files: Record<string, string>) {
	const dir = tempDir();

	for (const [path, content] of Object.entries(files)) {
		mkdirSync(join(dir, path, ".."), { recursive: true });
		writeFileSync(join(dir, path), content);
	}

	return dir;
}

describe("findContextFiles", () => {
	test("finds both files case-insensitively, root first", () => {
		const dir = repo({
			"product.md": "root product",
			"docs/PRODUCT.md": "docs product",
			"docs/Design.md": "docs design",
			".github/DESIGN.md": "github design",
		});

		expect(findContextFiles(dir)).toEqual([
			{ path: "PRODUCT.md", content: "root product", source: "product.md" },
			{ path: "DESIGN.md", content: "docs design", source: "docs/Design.md" },
		]);
	});

	test("searches docs, doc, design, .github and .rabisco in order", () => {
		expect(findContextFiles(repo({ ".rabisco/DESIGN.md": "r", "design/design.md": "d" }))).toEqual([
			{ path: "DESIGN.md", content: "d", source: "design/design.md" },
		]);
		expect(findContextFiles(repo({ ".rabisco/PRODUCT.md": "r", "src/PRODUCT.md": "no" }))).toEqual([
			{ path: "PRODUCT.md", content: "r", source: ".rabisco/PRODUCT.md" },
		]);
		expect(findContextFiles(repo({ "README.md": "x" }))).toEqual([]);
	});

	test("skips big files and folders with the name", () => {
		const dir = repo({ "DESIGN.md": "x".repeat(MAX_CONTEXT_FILE_BYTES + 1), "docs/DESIGN.md": "small" });
		mkdirSync(join(dir, "PRODUCT.md"));
		expect(findContextFiles(dir)).toEqual([{ path: "DESIGN.md", content: "small", source: "docs/DESIGN.md" }]);
	});

	test("throws a clear error for a missing folder or a file", () => {
		const dir = repo({ "file.txt": "" });
		expect(() => findContextFiles(join(dir, "nope"))).toThrow(/Folder not found/);
		expect(() => findContextFiles(join(dir, "file.txt"))).toThrow(/Not a folder/);
	});
});
