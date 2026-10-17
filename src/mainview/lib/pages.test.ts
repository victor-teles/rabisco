import { describe, expect, test } from "bun:test";
import type { Snapshot } from "@/lib/history";
import { addPage, deletePage, moveToPage, onOpenPage, renamePage } from "@/lib/pages";
import { normalizePages, onPage, openPage, pageOf } from "../../shared/pages";
import type { Annotation, Frame } from "../../shared/types";

const frame = (file: string, x = 0, page?: string): Frame => {
	const made: Frame = { file, name: file, device: "mobile", x, y: 0, width: 100, height: 200 };

	if (page) made.page = page;

	return made;
};

const note = (id: string, page?: string): Annotation => {
	const made: Annotation = { kind: "note", id, text: "", color: "yellow", x: 0, y: 0, width: 80, height: 80 };

	if (page) made.page = page;

	return made;
};

const twoPages = (): Snapshot => ({
	pages: [
		{ id: "p1", name: "Page 1" },
		{ id: "p2", name: "Flows" },
	],
	frames: [
		frame("screens/home.tsx", 0, "p1"),
		frame("screens/cart.tsx", 0, "p2"),
		frame("screens/cart.alt-1.tsx", 0, "p2"),
	],
	files: { "screens/home.tsx": "home", "screens/cart.tsx": "cart", "screens/cart.alt-1.tsx": "alt", "DESIGN.md": "" },
	annotations: [note("n1", "p1"), note("n2", "p2")],
	comments: [
		{ id: "c1", file: "screens/cart.tsx", x: 1, y: 1, text: "", createdAt: "" },
		{ id: "c2", x: 1, y: 1, text: "", createdAt: "", page: "p2" },
		{ id: "c3", x: 1, y: 1, text: "", createdAt: "", page: "p1" },
	],
});

describe("page membership", () => {
	test("an item without a page, or with one that's gone, is on the first page", () => {
		const pages = [
			{ id: "a", name: "A" },
			{ id: "b", name: "B" },
		];

		expect(pageOf({}, pages)).toBe("a");
		expect(pageOf({ page: "gone" }, pages)).toBe("a");
		expect(pageOf({ page: "b" }, pages)).toBe("b");
		expect(pageOf({ page: "b" }, [])).toBeUndefined();
	});

	test("one page shows everything", () => {
		const frames = [frame("screens/a.tsx", 0, "x")];

		expect(onPage(frames, [], undefined)).toBe(frames);
	});

	test("the open page falls back to the first", () => {
		const pages = [{ id: "a", name: "A" }];

		expect(openPage({ pages, page: "gone" })).toBe("a");
		expect(openPage({})).toBeUndefined();
	});

	test("normalizes names and drops repeated ids", () => {
		expect(normalizePages([{ id: "a", name: "  " }, { id: "a" }, { id: "b", name: " Flows " }, "x"])).toEqual([
			{ id: "a", name: "Page 1" },
			{ id: "b", name: "Flows" },
		]);
	});
});

describe("onOpenPage", () => {
	test("puts new items without a page on the open page", () => {
		const present = twoPages();

		const next = onOpenPage(
			present,
			{
				...present,
				frames: [...present.frames, frame("screens/new.tsx")],
				annotations: [...present.annotations!, note("n3", "gone")],
			},
			"p2",
		);

		expect(next.frames.at(-1)!.page).toBe("p2");
		expect(next.annotations!.at(-1)!.page).toBe("p2");
		expect(next.frames[0]!.page).toBe("p1");
	});

	test("leaves a pinned comment to its screen", () => {
		const present = twoPages();
		const pinned = { id: "c4", file: "screens/home.tsx", x: 1, y: 1, text: "", createdAt: "" };
		const next = onOpenPage(present, { ...present, comments: [...present.comments!, pinned] }, "p2");

		expect(next.comments!.at(-1)).toEqual(pinned);
	});

	test("does nothing with one page", () => {
		const present: Snapshot = { frames: [], files: {} };
		const update = { ...present, frames: [frame("screens/a.tsx")] };

		expect(onOpenPage(present, update, undefined)).toBe(update);
	});
});

describe("addPage", () => {
	test("the first extra page names and tags the existing one", () => {
		const snapshot: Snapshot = {
			frames: [frame("screens/a.tsx")],
			files: {},
			annotations: [note("n1")],
			comments: [{ id: "c", x: 0, y: 0, text: "", createdAt: "" }],
		};

		const next = addPage(snapshot, { id: "p2", name: "Page 2" }, "p1");

		expect(next.pages).toEqual([
			{ id: "p1", name: "Page 1" },
			{ id: "p2", name: "Page 2" },
		]);
		expect(next.frames[0]!.page).toBe("p1");
		expect(next.annotations![0]!.page).toBe("p1");
		expect(next.comments![0]!.page).toBe("p1");
	});

	test("later pages are appended", () => {
		expect(addPage(twoPages(), { id: "p3", name: "Page 3" }, "unused").pages!.map((page) => page.id)).toEqual([
			"p1",
			"p2",
			"p3",
		]);
	});
});

describe("renamePage", () => {
	test("trims the name and ignores an empty one", () => {
		expect(renamePage(twoPages(), "p2", "  Checkout ").pages![1]!.name).toBe("Checkout");

		const snapshot = twoPages();

		expect(renamePage(snapshot, "p2", "   ")).toBe(snapshot);
	});
});

describe("deletePage", () => {
	test("removes the page with its screens, files, notes and comments", () => {
		const next = deletePage(twoPages(), "p2");

		expect(next.pages!.map((page) => page.id)).toEqual(["p1"]);
		expect(next.frames.map((each) => each.file)).toEqual(["screens/home.tsx"]);
		expect(Object.keys(next.files)).toEqual(["screens/home.tsx", "DESIGN.md"]);
		expect(next.annotations!.map((each) => each.id)).toEqual(["n1"]);
		expect(next.comments!.map((each) => each.id)).toEqual(["c3"]);
	});

	test("keeps the last page", () => {
		const snapshot = deletePage(twoPages(), "p2");

		expect(deletePage(snapshot, "p1")).toBe(snapshot);
	});
});

describe("moveToPage", () => {
	test("moves a screen with its alternates, beside the page's screens when they'd overlap", () => {
		const next = moveToPage(twoPages(), ["screens/cart.tsx"], "p1");
		const cart = next.frames.find((each) => each.file === "screens/cart.tsx")!;
		const alt = next.frames.find((each) => each.file === "screens/cart.alt-1.tsx")!;

		expect(cart.page).toBe("p1");
		expect(alt.page).toBe("p1");
		expect(cart.x).toBe(340);
	});

	test("keeps the place when nothing is there", () => {
		const snapshot = twoPages();
		snapshot.frames[0] = frame("screens/home.tsx", 5000, "p1");

		expect(moveToPage(snapshot, ["screens/cart.tsx"], "p1").frames[1]!.x).toBe(0);
	});
});
