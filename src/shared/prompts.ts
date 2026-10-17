import type { ChatMessage } from "./types";
import { baseOf } from "./variations";

/** One prompt of the library in `PROMPTS.md`: a `## title` section, newest first. Plain Markdown, so it diffs and reads well */
export type SavedPrompt = { title: string; text: string };

/** A prompt sent in a chat, with the screens its reply changed */
export type PastPrompt = { id: string; text: string; createdAt: string; files: string[] };

const HEADER = "# Prompts\n\nSaved prompts for this project. Rabisco lists them in Prompts (⌥⌘P).\n";

const TITLE_LENGTH = 60;

const SECTION = /^## (.*)$/;

/** A line of the prompt that would read as a heading is escaped, and put back on read */
const escape = (text: string) => text.replace(/^(\\*)(#)/gm, "\\$1$2");

const unescape = (text: string) => text.replace(/^\\(\\*#)/gm, "$1");

export function promptTitle(text: string) {
	const first = text.trim().split("\n")[0]?.trim() ?? "";

	return first.length > TITLE_LENGTH ? `${first.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : first;
}

export function parsePrompts(markdown: string | undefined): SavedPrompt[] {
	if (!markdown) return [];
	const prompts: SavedPrompt[] = [];
	let current: { title: string; lines: string[] } | null = null;

	const close = () => {
		if (!current) return;
		const text = unescape(current.lines.join("\n").trim()) || current.title;

		if (text) prompts.push({ title: current.title || promptTitle(text), text });
	};

	for (const line of markdown.split(/\r?\n/)) {
		const heading = SECTION.exec(line);

		if (heading) {
			close();
			current = { title: heading[1]!.trim(), lines: [] };
		} else if (current) current.lines.push(line);
	}

	close();

	return prompts;
}

export function writePrompts(prompts: SavedPrompt[]) {
	const sections = prompts.map((prompt) => {
		const title = prompt.title.replace(/\s+/g, " ").trim();
		const text = prompt.text.trim();

		return text === title ? `## ${title}\n` : `## ${title}\n\n${escape(text)}\n`;
	});

	return [HEADER, ...sections].join("\n");
}

const sameText = (a: string, b: string) => a.trim() === b.trim();

/** Adds `text` at the top; saving a prompt that is already there moves it up */
export function withPrompt(markdown: string | undefined, text: string) {
	const prompts = parsePrompts(markdown).filter((prompt) => !sameText(prompt.text, text));

	return writePrompts([{ title: promptTitle(text), text: text.trim() }, ...prompts]);
}

export function withoutPrompt(markdown: string | undefined, text: string) {
	return writePrompts(parsePrompts(markdown).filter((prompt) => !sameText(prompt.text, text)));
}

/** User prompts, newest first, each with the files the reply after it changed */
export function pastPrompts(messages: ChatMessage[]): PastPrompt[] {
	const past: PastPrompt[] = [];

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i]!;

		if (message.role !== "user" || !message.content.trim()) continue;
		const reply = messages[i + 1]?.role === "assistant" ? messages[i + 1] : undefined;
		const files = (reply?.summary?.files ?? []).flatMap((file) => (file.change === "deleted" ? [] : [file.path]));

		past.push({ id: message.id, text: message.content.trim(), createdAt: message.createdAt, files });
	}

	return past.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The same text sent twice shows once, at its latest */
export function distinctPrompts(prompts: PastPrompt[]) {
	const seen = new Set<string>();

	return prompts.filter((prompt) => {
		if (seen.has(prompt.text)) return false;
		seen.add(prompt.text);

		return true;
	});
}

/** The prompts that changed `file`, or an alternate of it */
export function promptsForScreen(prompts: PastPrompt[], file: string) {
	const base = baseOf(file);

	return prompts.filter((prompt) => prompt.files.some((path) => baseOf(path) === base));
}
