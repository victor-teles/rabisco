import { describe, expect, test } from "bun:test";
import { assetKey, assetType, rewriteCssUrls, rewriteSrcset } from "./assets";

describe("assetKey", () => {
	test("gives the public path a screen points to", () => {
		expect(assetKey("/images/logo.png")).toBe("/images/logo.png");
		expect(assetKey("./images/logo.png?v=2")).toBe("/images/logo.png");
		expect(assetKey("images/photo.JPG#top")).toBe("/images/photo.JPG");
		expect(assetKey(" /hero.svg ")).toBe("/hero.svg");
	});

	test("ignores other origins, inline URLs, escapes and non-images", () => {
		for (const value of [
			"https://example.com/a.png",
			"//cdn.example.com/a.png",
			"data:image/png;base64,AAAA",
			"blob:null/1234",
			"/images/../secret.png",
			"/images/./a.png",
			"/notes.txt",
			"/images/",
			"",
		]) {
			expect(assetKey(value)).toBeNull();
		}
	});
});

test("assetType", () => {
	expect(assetType("/a.svg")).toBe("image/svg+xml");
	expect(assetType("/a.JPEG")).toBe("image/jpeg");
	expect(assetType("/a.txt")).toBeNull();
});

test("rewriteCssUrls points known images at their URLs and leaves the rest", () => {
	const urls = new Map([["/images/a.png", "blob:null/a"]]);

	const css = rewriteCssUrls(
		`.a{background-image:url(/images/a.png)}.b{background:url("./images/a.png?x") no-repeat}.c{background:url('/images/b.png')}.d{background:url(https://x.test/a.png)}`,
		(key) => urls.get(key),
	);

	expect(css).toBe(
		`.a{background-image:url("blob:null/a")}.b{background:url("blob:null/a") no-repeat}.c{background:url('/images/b.png')}.d{background:url(https://x.test/a.png)}`,
	);
	expect(rewriteCssUrls(".a{color:red}", () => "never")).toBe(".a{color:red}");
});

test("rewriteSrcset points each known image at its URL and keeps descriptors and separators", () => {
	const urls = new Map([
		["/images/a.png", "blob:null/a"],
		["/images/a@2x.png", "blob:null/a2"],
	]);

	const resolve = (key: string) => urls.get(key);

	expect(rewriteSrcset("/images/a.png 1x, ./images/a@2x.png?v=3 2x", resolve)).toBe("blob:null/a 1x, blob:null/a2 2x");
	expect(rewriteSrcset("/images/a.png,, /images/b.png 640w", resolve)).toBe("blob:null/a,, /images/b.png 640w");
	expect(rewriteSrcset(" images/a.png 100w,https://x.test/a.png 200w ", resolve)).toBe(
		" blob:null/a 100w,https://x.test/a.png 200w ",
	);
	expect(rewriteSrcset("data:image/png;base64,AA== 1x, /images/a@2x.png 2x", resolve)).toBe(
		"data:image/png;base64,AA== 1x, blob:null/a2 2x",
	);
	expect(rewriteSrcset("/images/a.png", resolve)).toBe("blob:null/a");
	expect(rewriteSrcset("", resolve)).toBe("");
});
