import { describe, expect, test } from "bun:test";
import type { CanvasComment, Frame } from "../../shared/types";
import { commentsPrompt, commentThreads, openOnScreen, threadView } from "./comment-threads";

const frame: Frame = {
	file: "screens/home.tsx",
	name: "Home",
	device: "mobile",
	x: 100,
	y: 50,
	width: 390,
	height: 844,
};

const comment = (id: string, rest: Partial<CanvasComment> = {}): CanvasComment => ({
	id,
	x: 10,
	y: 20,
	text: id,
	createdAt: "2026-10-01T10:00:00.000Z",
	...rest,
});

describe("commentThreads", () => {
	test("open first, newest first, numbered like the pins", () => {
		const { open, resolved } = commentThreads(
			[comment("a"), comment("b", { resolved: true }), comment("c", { file: frame.file }), comment("d")],
			[frame],
		);

		expect(open.map((t) => [t.comment.id, t.number])).toEqual([
			["d", 4],
			["c", 3],
			["a", 1],
		]);
		expect(resolved.map((t) => t.number)).toEqual([2]);
	});

	test("names the screen a thread is pinned to", () => {
		const { open } = commentThreads([comment("a", { file: frame.file }), comment("b")], [frame]);
		expect(open.map((t) => t.screen)).toEqual([null, "Home"]);
	});
});

describe("threadView", () => {
	test("a pinned thread shows its screen", () => {
		expect(threadView(comment("a", { file: frame.file }), [frame])).toEqual([frame]);
	});

	test("a canvas pin shows the area around it", () => {
		expect(threadView(comment("a"), [])).toEqual([{ x: -230, y: -220, width: 480, height: 480 }]);
	});

	test("nothing for a pin whose screen is gone", () => {
		expect(threadView(comment("a", { file: "screens/gone.tsx" }), [frame])).toEqual([]);
	});
});

describe("openOnScreen", () => {
	test("keeps the screen's open threads in pin order", () => {
		const threads = openOnScreen(
			[
				comment("a", { file: frame.file }),
				comment("b"),
				comment("c", { file: frame.file, resolved: true }),
				comment("d", { file: frame.file }),
			],
			frame.file,
		);

		expect(threads.map((t) => [t.comment.id, t.number])).toEqual([
			["a", 1],
			["d", 4],
		]);
	});
});

describe("commentsPrompt", () => {
	test("one thread is its text, then its replies", () => {
		const thread = comment("a", {
			text: " Make the button bigger ",
			replies: [{ id: "r", text: "And blue", createdAt: "" }],
		});

		expect(commentsPrompt([{ comment: thread, number: 1 }])).toBe("Make the button bigger\nReply: And blue");
	});

	test("several become a list named by their pins and elements", () => {
		const prompt = commentsPrompt(
			[
				{
					comment: comment("a", {
						text: "Bigger\nand bolder",
						replies: [{ id: "r", text: "Blue too", createdAt: "" }],
					}),
					number: 2,
					element: "<Button> “Sign in”",
				},
				{ comment: comment("b", { text: "Fix the spacing" }), number: 5 },
			],
			"Home",
		);

		expect(prompt).toBe(
			[
				"Address these comments on Home:",
				"- #2, on <Button> “Sign in”: Bigger",
				"  and bolder",
				"  Reply: Blue too",
				"- #5: Fix the spacing",
			].join("\n"),
		);
	});
});
