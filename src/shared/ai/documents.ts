// Decision 0037. A PRD or any Markdown file goes into the prompt as text, so every provider reads it.

import { isString } from "../guards";
import { isJsonArray, isJsonObject, type Json } from "../json";
import type { PromptDocument } from "./contract";

export const DOCUMENT_LIMITS = { count: 4, chars: 60_000 } as const;

export const DOCUMENT_ACCEPT = ".md,.markdown,.mdx,.txt,text/markdown,text/plain";

const DOCUMENT_NAME = /\.(?:md|markdown|mdx|txt)$/i;

const DOCUMENT_TYPES: ReadonlySet<string> = new Set(["text/markdown", "text/x-markdown", "text/plain"]);

export const isDocumentFile = (file: { name: string; type: string }) =>
	DOCUMENT_TYPES.has(file.type) || DOCUMENT_NAME.test(file.name);

export const CUT_NOTE = "\n\n[The rest of this document was cut to fit.]";

export function promptDocument(name: string, text: string): PromptDocument | null {
	const content = text.replace(/\r\n?/g, "\n").trim();

	if (!content) return null;

	if (content.length <= DOCUMENT_LIMITS.chars) return { name, content };

	return { name, content: `${content.slice(0, DOCUMENT_LIMITS.chars).trimEnd()}${CUT_NOTE}` };
}

export function parseDocuments(value: Json | undefined): PromptDocument[] {
	if (!isJsonArray(value)) return [];

	return value
		.flatMap((item) =>
			isJsonObject(item) && isString(item.name) && isString(item.content)
				? [{ name: item.name, content: item.content }]
				: [],
		)
		.slice(0, DOCUMENT_LIMITS.count);
}
