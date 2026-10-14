import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { createCompiler } from "../../mainview/lib/render/tailwind";
import { renderScreen } from "../../bun/test-utils";
import { tokensToCss } from "../context/tokens";
import { htmlScreen } from "./html";

const SCREEN = `export default function Welcome() {
	return (
		<main className="flex min-h-screen flex-col gap-4 bg-background p-6 text-foreground">
			<img src="/images/logo.png" srcSet="/images/logo.png 1x, /images/logo@2x.png 2x" alt="Coffee & co" />
			<div className="h-24 rounded-lg" style={{ backgroundImage: "url(/images/hero.jpg)" }} />
			<h1 className="text-2xl font-semibold text-primary">Welcome</h1>
		</main>
	);
}
`;

const assets = {
	"/images/logo.png": "bG9nbw==",
	"/images/logo@2x.png": "bG9nbzI=",
	"/images/hero.jpg": "aGVybw==",
	"/images/unused.png": "eA==",
};

const byPath = (files: ReturnType<typeof htmlScreen>) => Object.fromEntries(files.map((file) => [file.path, file]));

test("a screen becomes a page, a stylesheet and the images it shows", () => {
	const files = byPath(htmlScreen({ title: "Coffee <Club>", markup: renderScreen(SCREEN), css: "body{}", assets }));

	expect(Object.keys(files).sort()).toEqual([
		"images/hero.jpg",
		"images/logo.png",
		"images/logo@2x.png",
		"index.html",
		"styles.css",
	]);

	const html = files["index.html"]!.content;
	expect(html).toContain("<title>Coffee &lt;Club&gt;</title>");
	expect(html).toContain('<link rel="stylesheet" href="styles.css" />');
	expect(html).toContain('src="images/logo.png"');
	expect(html).toContain('srcSet="images/logo.png 1x, images/logo@2x.png 2x"');
	expect(html).toContain("url(images/hero.jpg)");
	expect(html).not.toContain('"/images/');
	expect(files["images/logo.png"]).toEqual({ path: "images/logo.png", content: "bG9nbw==", encoding: "base64" });
});

test("image paths in the stylesheet become relative too; text between tags stays", () => {
	const css = '.hero{background:url(/images/hero.jpg)} .note::after{content:"/images/hero.jpg is the hero"}';
	const files = byPath(htmlScreen({ title: "A", markup: "<p>/images/hero.jpg</p>", css, assets }));

	expect(files["styles.css"]!.content).toBe(
		'.hero{background:url(images/hero.jpg)} .note::after{content:"images/hero.jpg is the hero"}',
	);
	expect(files["index.html"]!.content).toContain("<p>/images/hero.jpg</p>");
});

test("the stylesheet the app builds has the page's classes and the applied tokens", async () => {
	const node = join(import.meta.dir, "../../../node_modules");

	const compiler = await createCompiler({
		tailwindcss: readFileSync(join(node, "tailwindcss/index.css"), "utf8"),
		"tw-animate-css": readFileSync(join(node, "tw-animate-css/dist/tw-animate.css"), "utf8"),
	});

	const css = `${compiler.build(["text-primary", "rounded-lg", "p-6"])}\n${tokensToCss({ light: { primary: "#2563eb" }, dark: {} })}`;
	const page = byPath(htmlScreen({ title: "A", markup: renderScreen(SCREEN), css }))["styles.css"]!.content;

	expect(page).toContain(".text-primary {\n    color: var(--primary);");
	expect(page).toContain("--primary: oklch(0.205 0 0);");
	expect(page).toContain(":root:not(.dark) {\n\t--primary: #2563eb;");
});
