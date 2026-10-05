import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeTarget } from "../shared/prototype/links";
import { shareScreens, type ShareSnapshot } from "../shared/share/snapshot";
import { inlineRuntime, NORMALIZE_TARGET_JS, SNAPSHOT_GLOBAL, viewerFiles } from "../shared/share/viewer";
import { createShareService, readScreenRuntime } from "./share";
import { tempDir } from "./test-utils";

const snapshot = (name = "Shop </title>"): ShareSnapshot => ({
	version: 1,
	name,
	createdAt: "2026-10-04T00:00:00.000Z",
	start: "screens/welcome.tsx",
	screens: [{ file: "screens/welcome.tsx", name: "Welcome", device: "mobile", width: 390, height: 844 }],
	modules: {
		"screens/welcome.tsx": { source: "export default () => <p>Hi</p>", code: "exports.default = () => null;" },
	},
	css: ".p{color:red}",
	theme: "",
});

const runtime = {
	html: '<!doctype html><div id="root"></div><script src="./frame.js"></script>',
	js: "/* runtime */".padEnd(4000, " "),
};

describe("viewerFiles", () => {
	test("a static site with relative URLs and the snapshot as a classic script", () => {
		const files = Object.fromEntries(viewerFiles(snapshot(), runtime).map((file) => [file.path, file.content]));
		expect(Object.keys(files).sort()).toEqual(["index.html", "runtime/frame.html", "snapshot.js", "viewer.js"]);
		expect(files["index.html"]).toContain("<title>Shop &lt;/title&gt;</title>");
		expect(files["index.html"]).toContain('sandbox="allow-scripts" src="runtime/frame.html"');
		expect(files["index.html"]).not.toMatch(/(src|href)="\//);
		const window = {};
		new Function("window", files["snapshot.js"]!)(window);
		expect(window).toEqual({ [SNAPSHOT_GLOBAL]: snapshot() });
		expect(files["runtime/frame.html"]).toBe(`<!doctype html><div id="root"></div><script>${runtime.js}</script>`);
	});

	test("the inlined runtime can't close its script tag", () => {
		const html = inlineRuntime({ html: runtime.html, js: 'const a = "</script><script>alert(1)</SCRIPT>"; // <!-- x' });
		expect(html.match(/<\/script/gi)).toHaveLength(1);
		expect(html).toContain('"<\\/script><script>alert(1)<\\/SCRIPT>"; // <\\!-- x');
		expect(() => inlineRuntime({ html: "<html></html>", js: "" })).toThrow("doesn't load frame.js");
	});

	test("the viewer's link resolution matches the app's", () => {
		// SAFETY: NORMALIZE_TARGET_JS declares the viewer's `normalizeTarget(to: string): string`
		const normalize = new Function(`${NORMALIZE_TARGET_JS}; return normalizeTarget;`)() as (to: string) => string;

		for (const to of [
			"settings",
			"./settings.tsx",
			"/screens/settings.tsx",
			"screens/settings",
			" a\\b ",
			"components/x",
			"../up",
		]) {
			expect(normalize(to)).toBe(normalizeTarget(to));
		}
	});

	test("viewer.js parses", () => {
		const viewer = viewerFiles(snapshot(), runtime).find((file) => file.path === "viewer.js")!;
		expect(() => new Function(viewer.content)).not.toThrow();
	});
});

describe("share service", () => {
	let service: ReturnType<typeof createShareService> | null = null;
	afterEach(() => service?.stopAll());

	const create = () =>
		(service = createShareService({
			readRuntime: () => runtime,
			hostname: "127.0.0.1",
			lanAddress: () => "192.168.1.20",
			token: () => "tok123",
		}));

	test("serves the viewer under the token, read-only", async () => {
		const shares = create();
		const status = shares.publish("/p/app.rabisco", snapshot());
		expect(status.url).toMatch(/^http:\/\/192\.168\.1\.20:\d+\/tok123\/$/);
		expect(status.screens).toBe(1);
		const base = status.localUrl;

		const index = await fetch(base);
		expect(index.status).toBe(200);
		expect(index.headers.get("content-type")).toContain("text/html");
		expect(index.headers.get("cache-control")).toBe("no-store");
		expect(await index.text()).toContain("Shop &lt;/title&gt;");

		const frame = await fetch(`${base}runtime/frame.html`);
		expect(frame.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
		expect(await frame.text()).toContain("/* runtime */");
		expect((await fetch(`${base}runtime/frame.js`)).status).toBe(404);

		const redirect = await fetch(base.replace(/\/$/, ""), { redirect: "manual" });
		expect(redirect.status).toBe(308);
		expect(redirect.headers.get("location")).toBe("/tok123/");

		const origin = new URL(base).origin;
		expect((await fetch(`${origin}/wrong/`)).status).toBe(404);
		expect((await fetch(`${origin}/`)).status).toBe(404);
		expect((await fetch(`${base}../../etc/passwd`)).status).toBe(404);
		expect((await fetch(`${base}%2e%2e/rabisco.json`)).status).toBe(404);
		expect((await fetch(base, { method: "POST", body: "x" })).status).toBe(405);
		expect((await fetch(base, { method: "HEAD" })).status).toBe(200);
	});

	test("compresses large files when asked", () => {
		const shares = create();
		shares.publish("/p/app.rabisco", snapshot());

		const response = shares.handle(
			new Request("http://x/tok123/runtime/frame.html", { headers: { "Accept-Encoding": "gzip, br" } }),
		);

		expect(response.headers.get("content-encoding")).toBe("gzip");
	});

	test("update keeps the link; stop ends it", async () => {
		const shares = create();
		const first = shares.publish("/p/app.rabisco", snapshot("One"));
		const second = shares.publish("/p/app.rabisco", snapshot("Two"));
		expect(second.url).toBe(first.url);
		expect(await (await fetch(second.localUrl)).text()).toContain("<title>Two</title>");
		expect(shares.status("/p/app.rabisco")?.url).toBe(first.url);
		shares.stop("/p/app.rabisco");
		expect(shares.status("/p/app.rabisco")).toBeNull();
		expect(shares.handle(new Request(first.localUrl)).status).toBe(404);
	});

	test("rejects snapshots that aren't one", () => {
		const shares = create();
		expect(() => shares.publish("/p", { version: 1 })).toThrow();
		expect(() => shares.publish("/p", { ...snapshot(), screens: [] })).toThrow("no screens");
		expect(() => shares.publish("/p", { ...snapshot(), start: "screens/nope.tsx" })).toThrow();
		expect(() => shares.publish("/p", { ...snapshot(), modules: {} })).toThrow();
		expect(shares.status("/p")).toBeNull();
	});
});

test("readScreenRuntime reads the first folder that has the runtime", () => {
	const empty = tempDir();
	const dir = join(tempDir(), "runtime");
	mkdirSync(dir);
	writeFileSync(join(dir, "frame.html"), "<html>");
	writeFileSync(join(dir, "frame.js"), "js");
	expect(readScreenRuntime([empty, dir])).toEqual({ html: "<html>", js: "js" });
	expect(() => readScreenRuntime([empty])).toThrow("screen runtime");
});

test("shareScreens keeps picked screens in canvas order", () => {
	const frame = (file: string) => ({ file, name: "", device: "mobile" as const, x: 0, y: 0, width: 390, height: 844 });
	const files = { "screens/b.tsx": "", "screens/a.tsx": "", "screens/a.alt-1.tsx": "", "components/c.tsx": "" };

	const screens = shareScreens(
		[frame("screens/b.tsx"), frame("screens/a.alt-1.tsx"), frame("screens/a.tsx"), frame("screens/gone.tsx")],
		files,
	);

	expect(screens.map((screen) => [screen.file, screen.name])).toEqual([
		["screens/b.tsx", "B"],
		["screens/a.tsx", "A"],
	]);
});
