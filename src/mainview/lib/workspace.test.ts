import { describe, expect, test } from "bun:test";
import { viewportStore } from "./viewport";
import {
	forgetProject,
	parseLastProject,
	parseViewport,
	persistViewport,
	readLastProject,
	rememberProject,
	rememberViewport,
	savedViewport,
	withViewport,
	type KeyValueStore,
} from "./workspace";

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
	const map = new Map<string, string>();

	return {
		map,
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => void map.set(key, value),
		removeItem: (key) => void map.delete(key),
	};
}

const view = (x: number, zoom = 1) => ({ x, y: 0, zoom });

describe("last project", () => {
	test("remembers the project and its chat, and forgets it", () => {
		const store = memoryStore();
		expect(readLastProject(store)).toBeNull();

		rememberProject(store, { path: "/p/a", chatId: "chat-1" });
		expect(readLastProject(store)).toEqual({ path: "/p/a", chatId: "chat-1" });

		forgetProject(store);
		expect(readLastProject(store)).toBeNull();
	});

	test("ignores what it can't read", () => {
		const store = memoryStore();
		store.setItem("rabisco:last-project", "{ broken");
		expect(readLastProject(store)).toBeNull();
		expect(parseLastProject({ path: "" })).toBeNull();
		expect(parseLastProject({ path: "/p/a", chatId: 3 })).toEqual({ path: "/p/a", chatId: null });
	});
});

describe("viewports", () => {
	test("are kept per project, most recent first, up to a limit", () => {
		const list = withViewport(withViewport(withViewport([], "a", view(1)), "b", view(2)), "a", view(3), 2);
		expect(list).toEqual([
			{ path: "a", viewport: view(3) },
			{ path: "b", viewport: view(2) },
		]);
		expect(withViewport(list, "c", view(4), 2).map((entry) => entry.path)).toEqual(["c", "a"]);
	});

	test("round-trip through storage and reject bad values", () => {
		const store = memoryStore();
		rememberViewport(store, "/p/a", view(10, 0.5));
		rememberViewport(store, "/p/b", view(20));
		expect(savedViewport(store, "/p/a")).toEqual(view(10, 0.5));
		expect(savedViewport(store, "/p/c")).toBeNull();
		expect(parseViewport({ x: 1, y: 2, zoom: 0 })).toBeNull();
		expect(parseViewport({ x: "1", y: 2, zoom: 1 })).toBeNull();
	});

	test("saves once after panning stops, and on close", async () => {
		const store = memoryStore();
		const viewport = viewportStore(view(0));
		const writes: string[] = [];
		const setItem = store.setItem;

		store.setItem = (key, value) => {
			writes.push(value);
			setItem(key, value);
		};

		const stop = persistViewport("/p/a", viewport, store, 10);

		for (let x = 1; x <= 20; x++) viewport.set(view(x));
		expect(writes).toHaveLength(0);
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(writes).toHaveLength(1);
		expect(savedViewport(store, "/p/a")).toEqual(view(20));

		viewport.set(view(99));
		stop();
		expect(savedViewport(store, "/p/a")).toEqual(view(99));
		stop();
		expect(writes).toHaveLength(2);
	});
});
