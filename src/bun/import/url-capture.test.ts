import { describe, expect, test } from "bun:test";
import { assertReachable, captureAddress, createUrlCapture, type CaptureViewEvents } from "./url-capture";

const tree = JSON.stringify({
	title: "Acme",
	width: 390,
	root: { tag: "body", box: { x: 0, y: 0, width: 390, height: 800 }, styles: {}, children: [] },
});

const nonceOf = (script: string) => /const nonce = "([^"]+)"/.exec(script)?.[1] ?? "";

type FakeView = { url: string; width: number; scripts: string[]; closed: number; events: CaptureViewEvents | null };

function fakeView() {
	const state: FakeView = { url: "", width: 0, scripts: [], closed: 0, events: null };

	const open = (url: string, width: number, events: CaptureViewEvents) => {
		state.url = url;
		state.width = width;
		state.events = events;

		return { run: (script: string) => void state.scripts.push(script), close: () => void state.closed++ };
	};

	const answer = (payload: Record<string, string>) =>
		state.events!.message(JSON.stringify({ nonce: nonceOf(state.scripts.at(-1) ?? ""), ...payload }));

	return { state, open, answer };
}

const fast = { readyFallbackMs: 1_000, timeoutMs: 2_000 };

describe("captureAddress", () => {
	test("adds https and rejects other schemes", () => {
		expect(captureAddress(" acme.com/pricing ")).toBe("https://acme.com/pricing");
		expect(() => captureAddress("file:///etc/passwd")).toThrow("http and https");
		expect(() => captureAddress("javascript:alert(1)")).toThrow("http and https");
	});
});

describe("assertReachable", () => {
	const answering: typeof fetch = Object.assign(async () => new Response(null, { status: 403 }), {
		preconnect: fetch.preconnect,
	});

	const failing: typeof fetch = Object.assign(
		async () => {
			throw new TypeError("Unable to connect");
		},
		{ preconnect: fetch.preconnect },
	);

	test("any answer counts, even an error status", async () => {
		await expect(assertReachable("https://acme.com/", answering)).resolves.toBeUndefined();
	});

	test("a host that doesn't answer fails fast with its name", async () => {
		await expect(assertReachable("https://acme.invalid/", failing)).rejects.toThrow("couldn't reach acme.invalid");
	});
});

describe("createUrlCapture", () => {
	test("runs the capture script when the page is ready and closes the page after", async () => {
		const { state, open, answer } = fakeView();
		const capture = createUrlCapture(open, fast).capture("acme.com", 390);

		state.events!.ready();
		state.events!.message("not for us");
		answer({ url: "https://acme.com/", tree });
		const result = await capture;

		expect(state.url).toBe("https://acme.com/");
		expect(state.width).toBe(390);
		expect(result.tree.title).toBe("Acme");
		expect(state.closed).toBe(1);
	});

	test("ignores answers with another nonce", async () => {
		const { state, open } = fakeView();
		const capture = createUrlCapture(open, { readyFallbackMs: 1_000, timeoutMs: 50 }).capture("acme.com", 390);

		state.events!.ready();
		state.events!.message(JSON.stringify({ nonce: "guess", url: "https://acme.com/", tree }));

		await expect(capture).rejects.toThrow("took too long");
		expect(state.closed).toBe(1);
	});

	test("runs the script without a ready event after the fallback delay", async () => {
		const { state, open } = fakeView();
		const capture = createUrlCapture(open, { readyFallbackMs: 10, timeoutMs: 100 }).capture("acme.com", 390);

		await Bun.sleep(30);
		expect(state.scripts).toHaveLength(1);
		state.events!.download();

		await expect(capture).rejects.toThrow("file download");
	});

	test("a page error, a stop and a second capture end the page", async () => {
		const { state, open, answer } = fakeView();
		const captures = createUrlCapture(open, fast);
		const first = captures.capture("acme.com", 390);

		state.events!.ready();
		const second = captures.capture("example.com", 390);

		await expect(first).rejects.toThrow("stopped");
		state.events!.ready();
		answer({ error: "boom" });
		await expect(second).rejects.toThrow("boom");

		const third = captures.capture("example.com", 390);

		captures.stop();
		await expect(third).rejects.toThrow("stopped");
		expect(state.closed).toBe(3);
	});
});
