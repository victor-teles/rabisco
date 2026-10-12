import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { CapturedNode, CapturedTree } from "../../shared/import/captured-tree";
import { tempDir } from "../test-utils";
import { importCapturedImages } from "./images";

const box = { x: 0, y: 0, width: 10, height: 10 };

const img = (src: string, alt = ""): CapturedNode => ({
	tag: "img",
	box,
	styles: {},
	attrs: { src, alt },
	children: [],
});

const treeOf = (...children: CapturedNode[]): CapturedTree => ({
	title: "Acme",
	width: 390,
	root: { tag: "body", box, styles: {}, children },
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function fakeFetch(requested: string[]): typeof fetch {
	const fetcher = async (input: string | URL | Request) => {
		const url = String(input);

		requested.push(url);

		if (url.endsWith("/missing.png")) return new Response("no", { status: 404 });

		if (url.endsWith("/page.html")) return new Response("<html>", { headers: { "content-type": "text/html" } });

		return new Response(PNG, { headers: { "content-type": "image/png" } });
	};

	// SAFETY: the importer only calls fetch with a URL and options and reads ok, url, headers and arrayBuffer
	return fetcher as typeof fetch;
}

const srcs = (tree: CapturedTree) => tree.root.children.map((node) => node.attrs?.src);

describe("importCapturedImages", () => {
	test("copies images next to the project's images and points the tree at them", async () => {
		const dir = tempDir();
		const requested: string[] = [];
		const tree = treeOf(img("/logo.png", "Acme"), img("https://cdn.acme.com/hero.png"), img("/logo.png"));
		const result = await importCapturedImages(dir, tree, "https://acme.com/about/", fakeFetch(requested));

		expect(srcs(result.tree)).toEqual([
			"/images/imported/logo.png",
			"/images/imported/hero.png",
			"/images/imported/logo.png",
		]);
		expect(requested).toEqual(["https://acme.com/logo.png", "https://cdn.acme.com/hero.png"]);
		expect(readFileSync(join(dir, "public/images/imported/logo.png")).equals(PNG)).toBe(true);
		expect(result).toMatchObject({ copied: 2, failed: 0 });
		expect(srcs(tree)).toEqual(["/logo.png", "https://cdn.acme.com/hero.png", "/logo.png"]);
	});

	test("drops images that fail, aren't images or point at this machine", async () => {
		const requested: string[] = [];

		const tree = treeOf(
			img("/missing.png", "Team"),
			img("/page.html"),
			img("http://localhost:3000/secret.png"),
			img("http://192.168.1.2/router.png"),
		);

		const result = await importCapturedImages(tempDir(), tree, "https://acme.com/", fakeFetch(requested));

		expect(srcs(result.tree)).toEqual([undefined, undefined, undefined, undefined]);
		expect(result.tree.root.children[0]!.attrs?.alt).toBe("Team");
		expect(requested).toEqual(["https://acme.com/missing.png", "https://acme.com/page.html"]);
	});

	test("a local dev server may use its own host", async () => {
		const requested: string[] = [];

		const result = await importCapturedImages(
			tempDir(),
			treeOf(img("/a.png")),
			"http://localhost:5173/",
			fakeFetch(requested),
		);

		expect(srcs(result.tree)).toEqual(["/images/imported/a.png"]);
	});

	test("saves data images", async () => {
		const tree = treeOf(img(`data:image/png;base64,${PNG.toString("base64")}`));
		const result = await importCapturedImages(tempDir(), tree, "https://acme.com/", fakeFetch([]));

		expect(srcs(result.tree)).toEqual(["/images/imported/image.png"]);
	});
});
