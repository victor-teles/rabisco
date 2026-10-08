import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { AssetTracker, importImage, listAssets } from "./assets";
import { tempDir } from "./test-utils";

describe("importImage", () => {
	test("copies into public/images under a clean name", () => {
		const project = tempDir();
		const source = join(tempDir(), "My Photo (1).PNG");
		writeFileSync(source, "png-bytes");
		expect(importImage(project, source)).toBe("/images/my-photo-1.png");
		expect(readFileSync(join(project, "public/images/my-photo-1.png"), "utf8")).toBe("png-bytes");
	});

	test("reuses the same file and numbers a different one", () => {
		const project = tempDir();
		const dir = tempDir();
		const first = join(dir, "logo.svg");
		writeFileSync(first, "<svg/>");
		expect(importImage(project, first)).toBe("/images/logo.svg");
		expect(importImage(project, first)).toBe("/images/logo.svg");
		const other = join(tempDir(), "logo.svg");
		writeFileSync(other, "<svg></svg>");
		expect(importImage(project, other)).toBe("/images/logo-2.svg");
		expect(existsSync(join(project, "public/images/logo-2.svg"))).toBe(true);
	});

	test("refuses other files and missing projects", () => {
		const source = join(tempDir(), "notes.txt");
		writeFileSync(source, "hi");
		expect(() => importImage(tempDir(), source)).toThrow("Not an image");
		expect(() => importImage(join(tempDir(), "missing"), source)).toThrow("Folder not found");
	});
});

const base64 = (text: string) => Buffer.from(text).toString("base64");

function projectWithImages() {
	const project = tempDir();
	mkdirSync(join(project, "public/images/icons"), { recursive: true });
	writeFileSync(join(project, "public/images/logo.png"), "logo");
	writeFileSync(join(project, "public/images/icons/star.svg"), "<svg/>");
	writeFileSync(join(project, "public/robots.txt"), "not an image");
	writeFileSync(join(project, "public/images/.hidden.png"), "dot file");

	return project;
}

describe("listAssets", () => {
	test("lists images under public/ by the src screens write", () => {
		const project = projectWithImages();
		const outside = join(tempDir(), "secret.png");
		writeFileSync(outside, "secret");
		symlinkSync(outside, join(project, "public/images/link.png"));
		expect([...listAssets(project).keys()].sort()).toEqual(["/images/icons/star.svg", "/images/logo.png"]);
	});

	test("an empty map without public/", () => {
		expect(listAssets(tempDir()).size).toBe(0);
	});
});

describe("AssetTracker", () => {
	test("loads every image, then reports only what changed", () => {
		const project = projectWithImages();
		const tracker = new AssetTracker(project);
		expect(tracker.load()).toEqual({ "/images/logo.png": base64("logo"), "/images/icons/star.svg": base64("<svg/>") });
		expect(tracker.changes()).toEqual([]);

		writeFileSync(join(project, "public/images/logo.png"), "new logo");
		// Same size and mtime would look unchanged; a real edit moves the mtime
		utimesSync(join(project, "public/images/logo.png"), new Date(), new Date(Date.now() + 5_000));
		writeFileSync(join(project, "public/hero.webp"), "hero");
		rmSync(join(project, "public/images/icons/star.svg"));
		expect(tracker.changes().sort((a, b) => a.src.localeCompare(b.src))).toEqual([
			{ src: "/hero.webp", data: base64("hero") },
			{ src: "/images/icons/star.svg", data: null },
			{ src: "/images/logo.png", data: base64("new logo") },
		]);
		expect(tracker.changes()).toEqual([]);
	});
});
