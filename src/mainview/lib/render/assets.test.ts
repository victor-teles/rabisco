import { describe, expect, test } from "bun:test";
import { AssetStore } from "./assets";

const base64 = (text: string) => Buffer.from(text).toString("base64");

describe("AssetStore", () => {
	test("holds images as typed Blobs and bumps its version on change", async () => {
		const store = new AssetStore();
		let calls = 0;
		store.subscribe(() => calls++);
		store.reset({});
		expect(calls).toBe(0);

		store.reset({ "/images/a.png": base64("png"), "/notes.txt": base64("skipped") });
		expect(store.size).toBe(1);
		expect(store.get("/images/a.png")?.type).toBe("image/png");
		expect(await store.get("/images/a.png")?.text()).toBe("png");
		expect([calls, store.version]).toEqual([1, 1]);

		store.apply([]);
		expect(calls).toBe(1);
		store.apply([
			{ src: "/images/a.png", data: null },
			{ src: "/b.svg", data: base64("<svg/>") },
		]);
		expect(store.get("/images/a.png")).toBeUndefined();
		expect(await store.base64()).toEqual({ "/b.svg": base64("<svg/>") });
		expect(await store.dataUrls()).toEqual({ "/b.svg": `data:image/svg+xml;base64,${base64("<svg/>")}` });
	});

	test("delta sends each Blob once and deletes what's gone", () => {
		const store = new AssetStore();
		store.reset({ "/a.png": base64("a"), "/b.png": base64("b") });
		const sent = new Map<string, Blob>();
		const first = store.delta(sent);
		expect([...first.keys()].sort()).toEqual(["/a.png", "/b.png"]);
		expect(store.delta(sent).size).toBe(0);

		store.apply([
			{ src: "/a.png", data: base64("a2") },
			{ src: "/b.png", data: null },
		]);
		const next = store.delta(sent);
		expect(next.get("/a.png")).toBe(store.get("/a.png")!);
		expect(next.get("/b.png")).toBeNull();
		expect([...sent.keys()]).toEqual(["/a.png"]);
	});

	test("base64 survives files bigger than one chunk", async () => {
		const store = new AssetStore();
		const bytes = Buffer.alloc(100_000, 7).toString("base64");
		store.reset({ "/big.png": bytes });
		expect((await store.base64())["/big.png"]).toBe(bytes);
	});
});
