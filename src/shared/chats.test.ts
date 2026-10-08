import { describe, expect, test } from "bun:test";
import { chatTitle, isChatId, newChatId, withAppended } from "./chats";
import type { ChatMessage } from "./types";

const message = (role: ChatMessage["role"], content: string, createdAt = "2026-10-07T10:00:00.000Z"): ChatMessage => ({
	id: crypto.randomUUID(),
	role,
	content,
	createdAt,
});

describe("chats", () => {
	test("ids sort by creation time and are safe file names", () => {
		const id = newChatId(new Date("2026-10-07T14:30:12.000Z"));
		expect(id).toMatch(/^20261007-143012-[0-9a-f]{4}$/);
		expect(isChatId(id)).toBe(true);
		expect(newChatId(new Date("2026-10-08T00:00:00.000Z")) > id).toBe(true);

		for (const bad of ["", "../chat", "a/b", "a.jsonl", "x".repeat(65)]) expect(isChatId(bad)).toBe(false);
	});

	test("the title is the first prompt's first line, cut short", () => {
		expect(chatTitle([])).toBe("New chat");
		expect(chatTitle([message("assistant", "Hi"), message("user", "  A habit tracker\nwith streaks")])).toBe(
			"A habit tracker",
		);
		expect(chatTitle([message("user", "x".repeat(80))])).toBe(`${"x".repeat(59)}…`);
	});

	test("appending moves the chat to the top", () => {
		const older = [message("user", "Old", "2026-10-01T00:00:00.000Z")];
		let chats = withAppended([], "a", older);
		chats = withAppended(chats, "b", [message("user", "New", "2026-10-02T00:00:00.000Z")]);
		expect(chats.map((chat) => chat.id)).toEqual(["b", "a"]);

		chats = withAppended(chats, "a", [...older, message("assistant", "Done", "2026-10-03T00:00:00.000Z")]);
		expect(chats.map((chat) => [chat.id, chat.title, chat.messageCount])).toEqual([
			["a", "Old", 2],
			["b", "New", 1],
		]);
	});
});
