import { describe, expect, test } from "bun:test";
import { parseUrlCaptureMessage, urlCaptureScript } from "./url-capture";

const tree = JSON.stringify({
	title: "Acme",
	width: 1280,
	root: { tag: "body", box: { x: 0, y: 0, width: 1280, height: 800 }, styles: {}, children: [] },
});

describe("parseUrlCaptureMessage", () => {
	test("reads the tree and the page variables", () => {
		const message = JSON.stringify({
			nonce: "n1",
			url: "https://acme.com/",
			tree,
			vars: { "--primary": "#e11d48", "bad name": "x", "--long": "x".repeat(300) },
		});

		const result = parseUrlCaptureMessage(message, "n1");

		expect(result?.kind).toBe("captured");

		if (result?.kind !== "captured") return;
		expect(result.capture.tree.title).toBe("Acme");
		expect(result.capture.url).toBe("https://acme.com/");
		expect(result.capture.vars).toEqual({ "--primary": "#e11d48" });
	});

	test("ignores messages for another capture or that aren't JSON", () => {
		expect(parseUrlCaptureMessage(JSON.stringify({ nonce: "other", tree }), "n1")).toBeNull();
		expect(parseUrlCaptureMessage("hello", "n1")).toBeNull();
	});

	test("reports a page error and a broken tree", () => {
		expect(parseUrlCaptureMessage(JSON.stringify({ nonce: "n1", error: "boom" }), "n1")).toEqual({
			kind: "error",
			message: "The page couldn't be read: boom",
		});
		expect(parseUrlCaptureMessage(JSON.stringify({ nonce: "n1", tree: "{}" }), "n1")?.kind).toBe("error");
	});
});

describe("urlCaptureScript", () => {
	test("is one expression that compiles", () => {
		expect(() => new Function(`return ${urlCaptureScript("n1")}`)).not.toThrow();
	});
});
