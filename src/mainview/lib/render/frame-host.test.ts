import { afterAll, describe, expect, mock, test } from "bun:test";
import {
	heightReporter,
	isFrameMessage,
	LINK_TO_ATTRIBUTE,
	LOC_ATTRIBUTE,
	resolveHit,
	sourceVersion,
	type HostMessage,
} from "./protocol";
import { LOC_ATTRIBUTE as JSX_LOC_ATTRIBUTE } from "../../../shared/jsx";

// The real stylesheet imports Vite `?raw` assets; the host only needs its interface here
mock.module("./styles", () => ({
	screenStyles: { ready: true, css: "", subscribe: () => () => {}, whenReady: async () => {}, add: () => false },
}));

const scope: { window?: unknown } = globalThis;

const hadWindow = "window" in scope;

scope.window ??= { addEventListener: () => {} };

afterAll(() => {
	if (!hadWindow) delete scope.window;
});

const { FrameHost } = await import("./frame-host");

const fakeFrame = () => {
	const posted: HostMessage[] = [];

	const postMessage = (message: HostMessage) => {
		posted.push(message);
	};

	// SAFETY: FrameHost only calls `postMessage` on the window of these test frames, and only with a HostMessage
	const contentWindow = { postMessage } as Window;
	// SAFETY: FrameHost only reads `contentWindow` of the frames in these tests
	const frame = { contentWindow } as HTMLIFrameElement;

	return { frame, posted };
};

function lastPosted<T extends HostMessage["type"]>(posted: HostMessage[], type: T) {
	const matching = posted.filter((message): message is Extract<HostMessage, { type: T }> => message.type === type);
	const last = matching.at(-1);

	if (!last) throw new Error(`No ${type} message was posted`);

	return last;
}

describe("heightReporter", () => {
	test("rounds up and reports only changes", () => {
		const heights: number[] = [];
		const report = heightReporter((height) => heights.push(height));
		report(843.2);
		report(844);
		report(1200);
		report(1200);
		report(Number.NaN);
		report(-1);
		report(844);
		expect(heights).toEqual([844, 1200, 844]);
	});
});

describe("FrameHost", () => {
	test("surfaces content height changes", () => {
		const { frame } = fakeFrame();
		const host = new FrameHost(frame);
		const heights: number[] = [];
		host.onContentHeight = (height) => heights.push(height);
		expect(host.contentHeight).toBeNull();
		host.receive({ type: "size", height: 1400 });
		host.receive({ type: "size", height: 1400 });
		host.receive({ type: "size", height: 900 });
		expect(heights).toEqual([1400, 900]);
		expect(host.contentHeight).toBe(900);
		host.dispose();
	});

	test("size messages don't change the render status", () => {
		const { frame, posted } = fakeFrame();
		const host = new FrameHost(frame);
		host.receive({ type: "size", height: 800 });
		expect(host.status).toBe("loading");
		expect(posted).toEqual([]);
		host.dispose();
	});
});

const CARD = `export function StatCard({ label }: { label: string }) {\n\treturn <div className="rounded-xl border p-4">{label}</div>;\n}\n`;

const screen = (name: string) =>
	`import { StatCard } from "../components/stat-card";\nexport default function ${name}() {\n\treturn <main><StatCard label="${name}" /></main>;\n}\n`;

const PROJECT = { "screens/a.tsx": screen("A"), "screens/b.tsx": screen("B"), "components/stat-card.tsx": CARD };

const modulesMessages = (posted: HostMessage[]) =>
	posted.filter((m): m is Extract<HostMessage, { type: "modules" }> => m.type === "modules");

describe("FrameHost: components", () => {
	test("editing a component re-sends it to every screen that uses it, and nothing else", () => {
		const a = fakeFrame();
		const b = fakeFrame();
		const hostA = new FrameHost(a.frame);
		const hostB = new FrameHost(b.frame);

		for (const [host, entry] of [
			[hostA, "screens/a.tsx"],
			[hostB, "screens/b.tsx"],
		] as const) {
			host.receive({ type: "ready" });
			host.update(entry, PROJECT);
		}

		expect(Object.keys(modulesMessages(a.posted)[0]!.modules).sort()).toEqual([
			"components/stat-card.tsx",
			"screens/a.tsx",
		]);

		const edited = { ...PROJECT, "components/stat-card.tsx": CARD.replace("p-4", "p-6") };
		hostA.update("screens/a.tsx", edited);
		hostB.update("screens/b.tsx", edited);

		for (const { posted } of [a, b]) {
			const last = modulesMessages(posted).at(-1)!;
			expect(Object.keys(last.modules)).toEqual(["components/stat-card.tsx"]);
		}

		// A screen-only edit doesn't touch the other screen's frame
		const before = b.posted.length;
		hostB.update("screens/b.tsx", { ...edited, "screens/a.tsx": screen("A2") });
		expect(b.posted.length).toBe(before);
		hostA.dispose();
		hostB.dispose();
	});
});

describe("hit testing", () => {
	test("the runtime and the JSX tools agree on the attribute", () => {
		expect(LOC_ATTRIBUTE).toBe(JSX_LOC_ATTRIBUTE);
	});

	test("resolveHit keeps the entry's locations, innermost first, and skips other modules", () => {
		const chain = ["components/stat-card.tsx:40", null, "screens/a.tsx:120", "screens/a.tsx:80", "screens/a.tsx:80"];
		expect(resolveHit(chain, "screens/a.tsx")).toEqual({ path: "screens/a.tsx", starts: [120, 80], indices: [2, 3] });
		expect(resolveHit(["components/stat-card.tsx:40"], "screens/a.tsx")).toBeNull();
		expect(resolveHit(["screens/a.tsx.bak:3", "screens/a.tsx:x"], "screens/a.tsx")).toBeNull();
		expect(resolveHit([], "screens/a.tsx")).toBeNull();
	});

	test("hitTest asks the frame and resolves with its answer", async () => {
		const { frame, posted } = fakeFrame();
		const host = new FrameHost(frame);
		expect(await host.hitTest(10, 10)).toBeNull();
		host.receive({ type: "ready" });
		host.update("screens/a.tsx", PROJECT);
		const pending = host.hitTest(12, 34);
		const request = lastPosted(posted, "hit-test");
		expect(request).toMatchObject({ type: "hit-test", x: 12, y: 34 });
		const version = sourceVersion(PROJECT["screens/a.tsx"]!);
		const box = { x: 1, y: 2, width: 30, height: 40 };
		host.receive({
			type: "hit",
			id: request.id,
			hit: { path: "screens/a.tsx", starts: [95, 40], version, boxes: [box] },
		});
		// Missing boxes become null, aligned with the starts
		expect(await pending).toEqual({ path: "screens/a.tsx", starts: [95, 40], version, boxes: [box, null] });

		const other = host.hitTest(1, 1);
		const second = lastPosted(posted, "hit-test");
		host.receive({ type: "hit", id: second.id, hit: { path: "components/stat-card.tsx", starts: [3], version } });
		expect(await other).toBeNull();
		host.dispose();
	});

	test("malformed hits never reach the host", () => {
		const hit = { path: "screens/a.tsx", starts: [3], version: "v" };
		expect(isFrameMessage({ type: "hit", id: 1, hit })).toBe(true);
		expect(isFrameMessage({ type: "hit", id: 1, hit: null })).toBe(true);
		expect(isFrameMessage({ type: "hit", id: 1, hit: { path: "screens/a.tsx", starts: [3] } })).toBe(false);
		expect(isFrameMessage({ type: "hit", id: 1, hit: { ...hit, boxes: [null, { x: "1" }] } })).toBe(false);
		expect(isFrameMessage({ type: "hit", hit })).toBe(false);
	});

	test("track sends the element once ready, and only current boxes come back", () => {
		const { frame, posted } = fakeFrame();
		const host = new FrameHost(frame);
		const seen: unknown[] = [];
		host.onBoxes = (boxes) => seen.push(boxes);
		host.track(40, "v1");
		expect(posted).toEqual([]);
		host.receive({ type: "ready" });
		expect(posted.at(-1)).toEqual({ type: "track", start: 40, version: "v1" });
		const box = { x: 0, y: 0, width: 10, height: 10 };
		host.receive({ type: "boxes", start: 40, version: "v1", boxes: [box] });
		host.receive({ type: "boxes", start: 40, version: "v0", boxes: [box] });
		expect(isFrameMessage({ type: "boxes", start: 40, version: "v1", boxes: [{ x: 1 }] })).toBe(false);
		expect(seen).toEqual([{ start: 40, version: "v1", boxes: [box] }]);
		const count = posted.length;
		host.track(40, "v1");
		expect(posted.length).toBe(count);
		host.track(null, "v1");
		expect(posted.at(-1)).toEqual({ type: "track", start: null, version: "v1" });
		host.dispose();
	});

	test("editText resolves with the new text, null when cancelled, undefined when refused", async () => {
		const { frame, posted } = fakeFrame();
		const host = new FrameHost(frame);
		expect(await host.editText({ start: 5, version: "v", text: "Hi" })).toBeUndefined();
		host.receive({ type: "ready" });
		let started = false;
		const kept = host.editText({ start: 5, version: "v", text: "Hi", x: 3, y: 4 }, () => (started = true));
		expect(posted.at(-1)).toEqual({ type: "edit-text", start: 5, version: "v", text: "Hi", x: 3, y: 4 });
		host.receive({ type: "text-edit", start: 5, version: "v", state: "editing" });
		expect(started).toBe(true);
		host.endTextEdit(true);
		expect(posted.at(-1)).toEqual({ type: "end-edit", commit: true });
		host.receive({ type: "text-edit", start: 6, version: "v", state: "done", text: "Other" });
		host.receive({ type: "text-edit", start: 5, version: "v", state: "done", text: "Hello" });
		expect(await kept).toBe("Hello");
		const cancelled = host.editText({ start: 5, version: "v", text: "Hello" });
		host.receive({ type: "text-edit", start: 5, version: "v", state: "done", text: null });
		expect(await cancelled).toBeNull();
		const refused = host.editText({ start: 5, version: "v", text: "Hello" });
		host.receive({ type: "text-edit", start: 5, version: "v", state: "refused" });
		expect(await refused).toBeUndefined();
		const pending = host.editText({ start: 5, version: "v", text: "Hello" });
		host.dispose();
		expect(await pending).toBeNull();
	});
});

describe("play mode", () => {
	test("the runtime and the link tools agree on the attribute", async () => {
		const { LINK_ATTRIBUTE } = await import("../../../shared/prototype/links");
		expect(LINK_TO_ATTRIBUTE).toBe(LINK_ATTRIBUTE);
	});

	test("setPlay is sent once ready, and again after the frame reloads", () => {
		const { frame, posted } = fakeFrame();
		const host = new FrameHost(frame);
		host.setPlay(true);
		expect(posted).toEqual([]);
		host.receive({ type: "ready" });
		expect(posted).toContainEqual({ type: "play", on: true });
		const count = posted.length;
		host.setPlay(true);
		expect(posted.length).toBe(count);
		// A reloaded frame starts out of play mode
		posted.length = 0;
		host.receive({ type: "ready" });
		expect(posted).toEqual([{ type: "play", on: true }]);
		host.setPlay(false);
		expect(posted.at(-1)).toEqual({ type: "play", on: false });
		posted.length = 0;
		host.receive({ type: "ready" });
		expect(posted).toEqual([]);
		host.dispose();
	});

	test("navigate and escape reach the callbacks only in play mode", () => {
		const { frame } = fakeFrame();
		const host = new FrameHost(frame);
		const seen: string[] = [];
		host.onNavigate = (to) => seen.push(to);
		host.onEscape = () => seen.push("escape");
		host.receive({ type: "ready" });
		host.receive({ type: "navigate", to: "screens/b.tsx" });
		host.receive({ type: "escape" });
		expect(seen).toEqual([]);
		host.setPlay(true);
		host.receive({ type: "navigate", to: "screens/b.tsx" });
		host.receive({ type: "navigate", to: "back" });
		host.receive({ type: "navigate", to: "  " });
		expect(isFrameMessage({ type: "navigate", to: 3 })).toBe(false);
		host.receive({ type: "escape" });
		expect(seen).toEqual(["screens/b.tsx", "back", "escape"]);
		expect(host.status).toBe("ready");
		host.dispose();
	});
});

describe("FrameHost: image export", () => {
	const scene = { width: 390, height: 1200, background: null, ops: [], links: [] };

	test("whenRendered waits for the render, and fails on an error", async () => {
		const host = new FrameHost(fakeFrame().frame);
		const rendered = host.whenRendered(1000);
		host.receive({ type: "ready" });
		host.receive({ type: "rendered" });
		await rendered;
		await host.whenRendered(1000);
		host.dispose();

		const failing = new FrameHost(fakeFrame().frame);
		const waiting = failing.whenRendered(1000);
		failing.receive({ type: "error", error: { kind: "runtime", message: "boom" } });
		await expect(waiting).rejects.toThrow("boom");
		failing.dispose();
	});

	test("measure and snapshot pair replies by id", async () => {
		const { frame, posted } = fakeFrame();
		const host = new FrameHost(frame);
		host.receive({ type: "ready" });
		const measuring = host.measure();
		const measure = lastPosted(posted, "measure");
		host.receive({ type: "measured", id: measure.id + 100, height: 1 });
		host.receive({ type: "measured", id: measure.id, height: 1200 });
		expect(await measuring).toBe(1200);

		const snapshotting = host.snapshot({ type: "image/png", scale: 2 });
		const request = lastPosted(posted, "snapshot");
		expect(request.raster).toEqual({ type: "image/png", scale: 2 });
		host.receive({
			type: "snapshot",
			id: request.id,
			scene,
			raster: { dataUrl: "data:image/png;base64,AA==", scale: 2 },
		});
		expect((await snapshotting).scene.height).toBe(1200);

		const failing = host.snapshot();
		const second = lastPosted(posted, "snapshot");
		host.receive({ type: "snapshot", id: second.id, error: "no canvas" });
		await expect(failing).rejects.toThrow("no canvas");
		host.dispose();
	});

	test("pending requests end when the host is disposed", async () => {
		const host = new FrameHost(fakeFrame().frame);
		host.receive({ type: "ready" });
		const measuring = host.measure();
		const snapshotting = host.snapshot();
		host.dispose();
		expect(await measuring).toBeNull();
		await expect(snapshotting).rejects.toThrow();
	});
});
