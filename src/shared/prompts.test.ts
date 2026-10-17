import { describe, expect, test } from "bun:test";
import {
	distinctPrompts,
	parsePrompts,
	pastPrompts,
	promptsForScreen,
	promptTitle,
	withoutPrompt,
	withPrompt,
	writePrompts,
} from "./prompts";
import type { ChatMessage } from "./types";

describe("PROMPTS.md", () => {
	test("round-trips prompts, including lines that look like headings", () => {
		const prompts = [
			{ title: "States", text: "Make empty, loading and error versions of this screen" },
			{ title: "Release notes", text: "Add a changelog:\n## v2\n# big\nKeep it short" },
		];

		expect(parsePrompts(writePrompts(prompts))).toEqual(prompts);
	});

	test("reads hand-written sections and skips empty ones", () => {
		const markdown =
			"# Prompts\n\nIntro text\n\n## Dark mode\n\nCheck every screen in dark mode\n\n## \n\n## Only a title\n";

		expect(parsePrompts(markdown)).toEqual([
			{ title: "Dark mode", text: "Check every screen in dark mode" },
			{ title: "Only a title", text: "Only a title" },
		]);
	});

	test("saves at the top and moves a prompt saved again", () => {
		const one = withPrompt(undefined, "First prompt");
		const two = withPrompt(one, "Second prompt");
		const again = withPrompt(two, "First prompt ");

		expect(parsePrompts(two).map((prompt) => prompt.text)).toEqual(["Second prompt", "First prompt"]);
		expect(parsePrompts(again).map((prompt) => prompt.text)).toEqual(["First prompt", "Second prompt"]);
		expect(parsePrompts(withoutPrompt(again, "Second prompt")).map((prompt) => prompt.text)).toEqual(["First prompt"]);
	});

	test("titles a prompt by its first line", () => {
		expect(promptTitle("  Make it calmer\nand quieter")).toBe("Make it calmer");
		expect(promptTitle("x".repeat(80))).toHaveLength(60);
	});
});

const message = (fields: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">): ChatMessage => ({
	content: "",
	createdAt: "2026-10-16T10:00:00.000Z",
	...fields,
});

const changed = (...paths: string[]) => ({
	files: paths.map((path) => ({ path, change: "modified" as const, additions: 1, deletions: 0 })),
	problems: 0,
});

describe("past prompts", () => {
	const messages = [
		message({ id: "1", role: "user", content: "A habit tracker", createdAt: "2026-10-16T10:00:00.000Z" }),
		message({ id: "2", role: "assistant", summary: changed("screens/home.tsx", "screens/details.tsx") }),
		message({ id: "3", role: "user", content: "Bolder headings", createdAt: "2026-10-16T11:00:00.000Z" }),
		message({ id: "4", role: "assistant", summary: changed("screens/home.alt-2.tsx") }),
		message({ id: "5", role: "user", content: "What fonts work?", createdAt: "2026-10-16T12:00:00.000Z" }),
		message({ id: "6", role: "assistant", content: "Inter." }),
	];

	test("lists user prompts newest first with the files their reply changed", () => {
		expect(pastPrompts(messages).map((prompt) => [prompt.text, prompt.files])).toEqual([
			["What fonts work?", []],
			["Bolder headings", ["screens/home.alt-2.tsx"]],
			["A habit tracker", ["screens/home.tsx", "screens/details.tsx"]],
		]);
	});

	test("finds the prompts that changed a screen or its alternates", () => {
		const past = pastPrompts(messages);

		expect(promptsForScreen(past, "screens/home.tsx").map((prompt) => prompt.text)).toEqual([
			"Bolder headings",
			"A habit tracker",
		]);
		expect(promptsForScreen(past, "screens/details.tsx").map((prompt) => prompt.text)).toEqual(["A habit tracker"]);
	});

	test("keeps the latest of a prompt sent twice", () => {
		const twice = pastPrompts([
			message({ id: "a", role: "user", content: "Again", createdAt: "2026-10-16T10:00:00.000Z" }),
			message({ id: "b", role: "user", content: "Again", createdAt: "2026-10-16T12:00:00.000Z" }),
		]);

		expect(distinctPrompts(twice).map((prompt) => prompt.id)).toEqual(["b"]);
	});
});
