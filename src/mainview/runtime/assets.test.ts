import { describe, expect, test } from "bun:test";
import { FrameAssets } from "./assets";

const png = () => new Blob(["png"], { type: "image/png" });

describe("FrameAssets", () => {
	test("makes object URLs for posted Blobs and keeps data URLs", () => {
		const assets = new FrameAssets();
		expect(assets.url("/images/a.png")).toBeUndefined();
		const blob = png();
		expect(assets.apply({ "/images/a.png": blob, "/b.svg": "data:image/svg+xml;base64,PHN2Zy8+" })).toBe(true);
		const url = assets.url("./images/a.png?v=1")!;
		expect(url).toStartWith("blob:");
		expect(assets.blob(url)).toBe(blob);
		expect(assets.url("/b.svg")).toBe("data:image/svg+xml;base64,PHN2Zy8+");
		expect(assets.url("/images/missing.png")).toBeUndefined();
		expect(assets.apply({ "not a path": png() })).toBe(false);
	});

	test("replacing and deleting revoke the old URL", () => {
		const assets = new FrameAssets();
		assets.apply({ "/a.png": png() });
		const first = assets.url("/a.png")!;
		assets.apply({ "/a.png": png() });
		expect(assets.url("/a.png")).not.toBe(first);
		expect(assets.blob(first)).toBeUndefined();
		assets.apply({ "/a.png": null });
		expect(assets.url("/a.png")).toBeUndefined();
		assets.apply({ "/c.png": png() });
		expect(assets.apply({}, true)).toBe(true);
		expect(assets.url("/c.png")).toBeUndefined();
	});

	test("rewrites src and background URLs in props, and nothing else", () => {
		const assets = new FrameAssets();
		const untouched = { src: "/a.png", alt: "Logo" };
		expect(assets.props(untouched)).toBe(untouched);
		assets.apply({ "/a.png": "data:image/png;base64,AA==" });
		expect(assets.props(untouched)).toEqual({ src: "data:image/png;base64,AA==", alt: "Logo" });
		expect(untouched.src).toBe("/a.png");

		const remote = { src: "https://example.com/a.png" };
		expect(assets.props(remote)).toBe(remote);
		expect(assets.props(null)).toBeNull();

		expect(assets.props({ style: { backgroundImage: "url(/a.png)", color: "red" } })).toEqual({
			style: { backgroundImage: 'url("data:image/png;base64,AA==")', color: "red" },
		});
		const plain = { style: { color: "red" } };
		expect(assets.props(plain)).toBe(plain);
	});

	test("rewrites url() in the stylesheet", () => {
		const assets = new FrameAssets();
		expect(assets.css(".a{background:url(/a.png)}")).toBe(".a{background:url(/a.png)}");
		assets.apply({ "/a.png": "data:image/png;base64,AA==" });
		expect(assets.css(".a{background:url(/a.png)}")).toBe('.a{background:url("data:image/png;base64,AA==")}');
	});
});
