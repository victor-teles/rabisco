import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeTarget } from "../shared/prototype/links";
import { assertSnapshot, shareScreens, type ShareSnapshot } from "../shared/share/snapshot";
import {
	overlayRect,
	parseOverlayMode,
	parseTransition,
	type OverlayMode,
	type Rect,
	type Size,
} from "../shared/prototype/transitions";
import {
	inlineRuntime,
	LINK_OPTIONS_JS,
	motionTables,
	NORMALIZE_TARGET_JS,
	overlayMotionKey,
	screenMotionKey,
	EXPIRES_GLOBAL,
	SEALED_GLOBAL,
	SNAPSHOT_GLOBAL,
	viewerFiles,
} from "../shared/share/viewer";
import { COMMENT_BODY_LIMIT, type ViewerComment } from "../shared/share/comments";
import { sealText } from "../shared/share/publish";
import { createShareService, lanAddress, readScreenRuntime } from "./share";
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

	test("ships the icon scripts the screens import, which the frame loads from runtime/icons", () => {
		const withIcons = snapshot();
		withIcons.modules["screens/welcome.tsx"] = { source: "", code: "", icons: ["Sun", "CalendarDaysIcon", "Nope"] };
		withIcons.modules["components/tab.tsx"] = { source: "", code: "", icons: ["LucideSun"] };
		const icon = (file: string) => (file === "nope" ? null : `/* ${file} */`);

		const files = Object.fromEntries(
			viewerFiles(withIcons, { ...runtime, icon }).map((file) => [file.path, file.content]),
		);

		expect(Object.keys(files).filter((path) => path.startsWith("runtime/icons/"))).toEqual([
			"runtime/icons/sun.js",
			"runtime/icons/calendar-days.js",
		]);
		expect(files["runtime/icons/sun.js"]).toBe("/* sun */");
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

	test("the viewer reads transitions, overlay modes and overlay sizes like the app", () => {
		type ViewerLinkOptions = {
			parseTransition: (value: string | undefined) => string | null;
			parseOverlayMode: (value: string | undefined) => string | null;
			overlayRect: (mode: OverlayMode, screen: Size, overlay: Size) => Rect;
		};

		// SAFETY: LINK_OPTIONS_JS declares these three functions with these signatures
		const viewer = new Function(
			`${LINK_OPTIONS_JS}; return { parseTransition, parseOverlayMode, overlayRect };`,
		)() as ViewerLinkOptions;

		for (const value of [
			undefined,
			"",
			"slide",
			" Push ",
			"DISSOLVE",
			"instant",
			"fade",
			"overlay",
			"Modal",
			"sheet ",
		]) {
			expect(viewer.parseTransition(value)).toBe(parseTransition(value));
			expect(viewer.parseOverlayMode(value)).toBe(parseOverlayMode(value));
		}

		const screen = { width: 390, height: 844 };

		for (const overlay of [
			{ width: 320, height: 400 },
			{ width: 1440, height: 1024 },
		]) {
			expect(viewer.overlayRect("overlay", screen, overlay)).toEqual(overlayRect("overlay", screen, overlay));
			expect(viewer.overlayRect("sheet", screen, overlay)).toEqual(overlayRect("sheet", screen, overlay));
		}
	});

	test("the viewer's motion tables cover every transition and overlay", () => {
		const { screens, overlays } = motionTables();
		expect(screens[screenMotionKey("instant", "forward", false)]).toBeNull();
		expect(screens[screenMotionKey("push", "back", false)]?.top).toBe("outgoing");
		expect(screens[screenMotionKey("push", "back", true)]?.outgoing).toEqual([]);
		expect(overlays[overlayMotionKey("sheet", "", true, false)]?.panel[0]).toEqual({ transform: "translateY(100%)" });
		expect(overlays[overlayMotionKey("overlay", "instant", true, false)]).toBeNull();
		const viewer = viewerFiles(snapshot(), runtime).find((file) => file.path === "viewer.js")!;
		expect(viewer.content).toContain(JSON.stringify(motionTables()));
	});

	test("images travel in the snapshot and reach the frame before the modules", () => {
		const withImages = { ...snapshot(), assets: { "/images/logo.png": "data:image/png;base64,bG9nbw==" } };
		const files = Object.fromEntries(viewerFiles(withImages, runtime).map((file) => [file.path, file.content]));
		expect(files["snapshot.js"]).toContain('"/images/logo.png":"data:image/png;base64,bG9nbw=="');
		expect(files["viewer.js"]).toContain(
			'if (data.assets) post(record, { type: "assets", assets: data.assets, reset: true });',
		);
		expect(assertSnapshot(withImages)).toEqual(withImages);
		expect(() => assertSnapshot({ ...snapshot(), assets: { "/images/a.png": "https://x.test/a.png" } })).toThrow(
			"isn't an image",
		);
		expect(() => assertSnapshot({ ...snapshot(), assets: { "../a.png": "data:image/png;base64,AA==" } })).toThrow();
	});

	test("each screen's mode reaches its frame; a snapshot without modes renders the defaults", () => {
		const old = snapshot();
		const dark: ShareSnapshot = { ...old, screens: [{ ...old.screens[0]!, mode: { scheme: "dark" } }] };
		const viewer = viewerFiles(dark, runtime).find((file) => file.path === "viewer.js")!.content;

		expect(assertSnapshot(dark)).toEqual(dark);
		expect(assertSnapshot(old)).toEqual(old);
		expect(viewer).toContain('var DEFAULT_MODE = {"scheme":"light"};');
		expect(viewer).toContain("mode: modeOf(record.file), reset: true");
		expect(viewer).toContain("modules: {}, mode: modeOf(file) }");
		expect(() => assertSnapshot({ ...old, screens: [{ ...old.screens[0]!, mode: { scheme: "Dark Mode" } }] })).toThrow(
			"invalid screen",
		);
	});

	test("a sealed site holds only ciphertext and hides the project name", async () => {
		const sealed = await sealText(JSON.stringify(snapshot()), "password", 1000);

		const files = Object.fromEntries(
			viewerFiles(snapshot(), runtime, { sealed, expiresAt: "2026-11-01T00:00:00.000Z", noindex: true }).map((file) => [
				file.path,
				file.content,
			]),
		);

		const window = {};
		new Function("window", files["snapshot.js"]!)(window);
		expect(window).toEqual({ [SEALED_GLOBAL]: sealed, [EXPIRES_GLOBAL]: "2026-11-01T00:00:00.000Z" });
		expect(files["index.html"]).not.toContain("Shop");
		expect(files["index.html"]).toContain("<title>Shared design</title>");
		expect(files["index.html"]).toContain('<meta name="robots" content="noindex" />');
		expect(files["index.html"]).toContain('<iframe id="frame" title="Screen" sandbox="allow-scripts"></iframe>');
		expect(files["viewer.js"]).toContain("Wrong password");
		expect(files["viewer.js"]).toContain("This link has expired");
		expect(() => new Function(files["viewer.js"]!)).not.toThrow();
	});

	test("an export is not sealed, indexed or dated", () => {
		const files = Object.fromEntries(viewerFiles(snapshot(), runtime).map((file) => [file.path, file.content]));
		expect(files["index.html"]).not.toContain("robots");
		expect(files["snapshot.js"]).not.toContain(EXPIRES_GLOBAL);
	});

	test("viewer.js parses", () => {
		const viewer = viewerFiles(snapshot(), runtime).find((file) => file.path === "viewer.js")!;
		expect(() => new Function(viewer.content)).not.toThrow();
	});
});

describe("viewer inspect and comments", () => {
	test("inspect is in every viewer; comments only where a route takes them", () => {
		const plain = Object.fromEntries(viewerFiles(snapshot(), runtime).map((file) => [file.path, file.content]));

		const lan = Object.fromEntries(
			viewerFiles(snapshot(), runtime, { comments: true }).map((file) => [file.path, file.content]),
		);

		expect(plain["index.html"]).toContain('id="inspect"');
		expect(plain["index.html"]).not.toContain('id="comment"');
		expect(plain["index.html"]).not.toContain('id="composer"');
		expect(lan["index.html"]).toContain('id="comment"');
		expect(lan["index.html"]).toContain('maxlength="2000"');
		expect(() => new Function(plain["viewer.js"]!)).not.toThrow();
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

	test("compresses large files when asked", async () => {
		const shares = create();
		shares.publish("/p/app.rabisco", snapshot());

		const response = await shares.handle(
			new Request("http://x/tok123/runtime/frame.html", { headers: { "Accept-Encoding": "gzip, br" } }),
		);

		expect(response.headers.get("content-encoding")).toBe("gzip");
	});

	describe("viewer comments", () => {
		const received: { path: string; comment: ViewerComment }[] = [];

		const withComments = () =>
			(service = createShareService({
				readRuntime: () => runtime,
				hostname: "127.0.0.1",
				lanAddress: () => "192.168.1.20",
				token: () => "tok123",
				onComment: (path, comment) => void received.push({ path, comment }),
			}));

		const send = (base: string, body: string, headers: Record<string, string> = {}) =>
			fetch(`${base}comments`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body,
			});

		const comment = JSON.stringify({
			screen: "screens/welcome.tsx",
			x: 120.4,
			y: 900,
			text: "  Bigger\r\nbutton\u0007 ",
		});

		test("a comment on a shared screen reaches the project", async () => {
			received.length = 0;
			const { localUrl } = withComments().publish("/p/app.rabisco", snapshot());
			const response = await send(localUrl, comment, { Origin: new URL(localUrl).origin });

			expect(response.status).toBe(201);
			expect(received).toEqual([
				{ path: "/p/app.rabisco", comment: { screen: "screens/welcome.tsx", x: 120, y: 900, text: "Bigger\nbutton" } },
			]);
		});

		test("refuses other sites, other bodies and unknown screens", async () => {
			received.length = 0;
			const { localUrl } = withComments().publish("/p/app.rabisco", snapshot());

			expect((await send(localUrl, comment, { Origin: "http://evil.example" })).status).toBe(403);
			expect((await send(localUrl, comment, { "Content-Type": "text/plain" })).status).toBe(415);
			expect((await send(localUrl, "{")).status).toBe(400);
			expect((await send(localUrl, JSON.stringify({ screen: "screens/nope.tsx", x: 1, y: 1, text: "x" }))).status).toBe(
				400,
			);
			expect(
				(await send(localUrl, JSON.stringify({ screen: "screens/welcome.tsx", x: 1, y: 1, text: "  " }))).status,
			).toBe(400);
			expect(
				(await send(localUrl, JSON.stringify({ screen: "screens/welcome.tsx", x: -1, y: 1, text: "x" }))).status,
			).toBe(400);
			expect((await send(localUrl, "x".repeat(COMMENT_BODY_LIMIT + 1))).status).toBe(413);
			expect((await send(localUrl.replace("tok123", "wrong"), comment)).status).toBe(405);
			expect(received).toEqual([]);
		});

		test("refuses a long body sent without a length", async () => {
			const { localUrl } = withComments().publish("/p/app.rabisco", snapshot());
			const chunk = new TextEncoder().encode("x".repeat(4096));
			let sent = 0;

			const body = new ReadableStream<Uint8Array>({
				pull(controller) {
					if (sent++ < 8) controller.enqueue(chunk);
					else controller.close();
				},
			});

			const status = await fetch(`${localUrl}comments`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
			}).then(
				(response) => response.status,
				() => 413,
			);

			expect(status).toBe(413);
		});

		test("limits how fast comments arrive", async () => {
			const { localUrl } = withComments().publish("/p/app.rabisco", snapshot());
			const statuses = [];

			for (let i = 0; i < 21; i++) statuses.push((await send(localUrl, comment)).status);

			expect(statuses.slice(0, 20).every((status) => status === 201)).toBe(true);
			expect(statuses[20]).toBe(429);
		});

		test("a share without a comment handler stays read-only", async () => {
			const { localUrl } = create().publish("/p/app.rabisco", snapshot());

			expect((await send(localUrl, comment)).status).toBe(405);
		});
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
		expect((await shares.handle(new Request(first.localUrl))).status).toBe(404);
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

describe("lanAddress", () => {
	const ipv4 = (address: string, internal = false) => ({
		address,
		netmask: "255.255.255.0",
		family: "IPv4" as const,
		mac: "00:00:00:00:00:00",
		internal,
		cidr: null,
	});

	test("prefers Wi-Fi or Ethernet over a VPN or VM bridge listed first", () => {
		expect(
			lanAddress({
				lo0: [ipv4("127.0.0.1", true)],
				utun4: [ipv4("10.8.0.2")],
				bridge100: [ipv4("192.168.64.1")],
				vmnet8: [ipv4("172.16.5.1")],
				en0: [ipv4("192.168.1.20")],
			}),
		).toBe("192.168.1.20");
	});

	test("skips virtual interfaces when there is no en interface", () => {
		expect(lanAddress({ utun4: [ipv4("10.8.0.2")], eth1: [ipv4("10.0.0.5")] })).toBe("10.0.0.5");
	});

	test("falls back to the first private address, then any address", () => {
		expect(lanAddress({ en0: [ipv4("8.8.4.4")], utun4: [ipv4("10.8.0.2")] })).toBe("10.8.0.2");
		expect(lanAddress({ en0: [ipv4("8.8.4.4")] })).toBe("8.8.4.4");
		expect(lanAddress({ lo0: [ipv4("127.0.0.1", true)] })).toBeNull();
	});
});

test("readScreenRuntime reads the first folder that has the runtime", () => {
	const empty = tempDir();
	const dir = join(tempDir(), "runtime");
	mkdirSync(dir);
	writeFileSync(join(dir, "frame.html"), "<html>");
	writeFileSync(join(dir, "frame.js"), "js");
	mkdirSync(join(dir, "icons"));
	writeFileSync(join(dir, "icons", "sun.js"), "sun");
	const read = readScreenRuntime([empty, dir]);
	expect([read.html, read.js]).toEqual(["<html>", "js"]);
	expect([read.icon?.("sun"), read.icon?.("moon")]).toEqual(["sun", null]);
	expect(() => readScreenRuntime([empty])).toThrow("screen runtime");
});

test("shareScreens keeps picked screens in canvas order", () => {
	const frame = (file: string) => ({ file, name: "", device: "mobile" as const, x: 0, y: 0, width: 390, height: 844 });
	const files = { "screens/b.tsx": "", "screens/a.tsx": "", "screens/a.alt-1.tsx": "", "components/c.tsx": "" };

	const screens = shareScreens(
		[frame("screens/b.tsx"), frame("screens/a.alt-1.tsx"), frame("screens/a.tsx"), frame("screens/gone.tsx")],
		files,
		[],
	);

	expect(screens.map((screen) => [screen.file, screen.name])).toEqual([
		["screens/b.tsx", "B"],
		["screens/a.tsx", "A"],
	]);
});

test("shareScreens gives each screen the mode of its section", () => {
	const frame = (file: string, x: number) => ({
		file,
		name: "",
		device: "mobile" as const,
		x,
		y: 0,
		width: 390,
		height: 844,
	});

	const files = { "screens/a.tsx": "", "screens/b.tsx": "" };

	const dark = {
		id: "s",
		name: "Dark",
		color: "gray" as const,
		x: 1000,
		y: -100,
		width: 1000,
		height: 1200,
		modes: { scheme: "dark" },
	};

	const screens = shareScreens([frame("screens/a.tsx", 0), frame("screens/b.tsx", 1200)], files, [dark]);

	expect(screens.map((screen) => screen.mode)).toEqual([{ scheme: "light" }, { scheme: "dark" }]);
});
