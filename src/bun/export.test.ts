import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { freeExportDir, writeExportFiles } from "./export";
import { tempDir } from "./test-utils";

describe("writeExportFiles", () => {
	test("writes text and base64 files, creating folders", () => {
		const dir = join(tempDir(), "out");
		writeExportFiles(dir, [
			{ path: "src/screens/welcome.tsx", content: "export default 1" },
			{ path: "welcome.png", content: Buffer.from([1, 2, 3]).toString("base64"), encoding: "base64" },
		]);
		expect(readFileSync(join(dir, "src/screens/welcome.tsx"), "utf8")).toBe("export default 1");
		expect([...readFileSync(join(dir, "welcome.png"))]).toEqual([1, 2, 3]);
	});

	test("rejects paths outside the folder and writes nothing", () => {
		const dir = join(tempDir(), "out");

		for (const path of ["../escape.txt", "/etc/passwd", "a/../../b", ""]) {
			expect(() =>
				writeExportFiles(dir, [
					{ path: "ok.txt", content: "" },
					{ path, content: "" },
				]),
			).toThrow();
		}

		expect(existsSync(join(dir, "ok.txt"))).toBe(false);
	});

	test("needs an absolute folder", () => {
		expect(() => writeExportFiles("relative", [{ path: "a.txt", content: "" }])).toThrow();
	});
});

describe("freeExportDir", () => {
	test("adds a number when the folder is taken", () => {
		const parent = tempDir();
		expect(freeExportDir(parent, "app")).toBe(join(parent, "app"));
		mkdirSync(join(parent, "app"));
		mkdirSync(join(parent, "app-2"));
		expect(freeExportDir(parent, "app")).toBe(join(parent, "app-3"));
	});
});
