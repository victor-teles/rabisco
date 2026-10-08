import type { ChatMessage } from "./types";

/** One `<id>.jsonl` per chat session. Projects saved before sessions had a single `chat.jsonl` */
export const CHATS_DIR = "chats";

export const LEGACY_CHAT_FILE = "chat.jsonl";

const TITLE_LENGTH = 60;

export type ChatSummary = {
	id: string;
	/** The first prompt's first line */
	title: string;
	/** The last message's time */
	updatedAt: string;
	messageCount: number;
};

/** Also a file name, so nothing that could leave `chats/` */
export const isChatId = (id: string) => /^[\w-]{1,64}$/.test(id);

const pad = (value: number) => String(value).padStart(2, "0");

/** Sorts by creation time as text: `20261007-143012-a1b2` (UTC) */
export function newChatId(now = new Date()) {
	const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
	const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;

	return `${date}-${time}-${crypto.randomUUID().slice(0, 4)}`;
}

export function chatTitle(messages: ChatMessage[]) {
	const first = messages
		.find((message) => message.role === "user")
		?.content.trim()
		.split("\n")[0]
		?.trim();

	if (!first) return "New chat";

	return first.length > TITLE_LENGTH ? `${first.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : first;
}

export function summarizeChat(id: string, messages: ChatMessage[]): ChatSummary {
	return {
		id,
		title: chatTitle(messages),
		updatedAt: messages.at(-1)?.createdAt ?? "",
		messageCount: messages.length,
	};
}

/** Newest first; empty chats aren't listed */
export function sortChats(chats: ChatSummary[]) {
	return chats
		.filter((chat) => chat.messageCount > 0)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}

/** The summary list after `messages` were appended to chat `id` */
export function withAppended(chats: ChatSummary[], id: string, all: ChatMessage[]) {
	return sortChats([summarizeChat(id, all), ...chats.filter((chat) => chat.id !== id)]);
}
