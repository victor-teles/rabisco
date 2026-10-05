/**
 * Streaming parser for the text protocol of API providers (decision 0003):
 * `<rabisco-file …>…</rabisco-file>` becomes `file.*` events, `<rabisco-delete … />`
 * becomes `file.delete`, and text outside tags becomes `message.delta`.
 * Chunks may split anything anywhere, tag names included. The parser never
 * emits `done` or `error`; providers end the stream.
 */

import type { FileKind, GenerationEvent, ScreenMeta } from "../../shared/ai/contract";
import { screenNameFromPath, toKebab } from "../../shared/project";
import type { Device } from "../../shared/types";

const OPEN = "<rabisco-file";
const CLOSE = "</rabisco-file>";
const DELETE = "<rabisco-delete";
const TAGS = [OPEN, DELETE, CLOSE];
/** An unterminated `<rabisco-file …` longer than this is treated as plain text */
const MAX_TAG_LENGTH = 2000;

/** `status.label` emitted for a file that was still open when the stream ended (`detail` is its path). */
export const TRUNCATED_STATUS = "File cut off";

export type TextProtocolParser = {
	push(chunk: string): GenerationEvent[];
	/** Flushes buffered text. A file still open is truncated: no `file.end`, a `status` instead. */
	end(): GenerationEvent[];
	/** Paths with a `file.end` */
	readonly written: readonly string[];
	readonly deleted: readonly string[];
	/** Paths that were still open at `end()`; the caller should turn them into repair problems */
	readonly truncated: readonly string[];
	/** Whether any non-whitespace text was emitted as `message.delta` */
	readonly hasMessage: boolean;
};

type OpenFile = {
	/** null: a tag without a usable path; its content is swallowed */
	path: string | null;
	raw: string;
	/** Characters of the cleaned content already sent as `file.delta` */
	sent: number;
	body: { start: number; fenced: boolean } | null;
};

const ENTITIES: Record<string, string> = { "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" };

export function parseAttributes(source: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const m of source.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`/]+))/g)) {
		attrs[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? "").replace(/&(?:quot|apos|lt|gt|amp);/g, (e) => ENTITIES[e]!);
	}
	return attrs;
}

const normalizePath = (path: string) => path.trim().replace(/\\/g, "/").replace(/^(?:\.\/|\/)+/, "");

/** `kind` from the attribute when valid, otherwise from the path. */
export const inferKind = (path: string, kind?: string): FileKind =>
	kind === "screen" || kind === "component" || kind === "context"
		? kind
		: path.startsWith("components/")
			? "component"
			: /\.md$/i.test(path)
				? "context"
				: "screen";

/** Where the file body starts: after the tag's own newline, and after a ```tsx fence line. null: not known yet. */
function bodyStart(raw: string, final: boolean): { start: number; fenced: boolean } | null {
	const lead = raw.length - raw.trimStart().length;
	const rest = raw.slice(lead);
	if (rest.startsWith("```")) {
		const newline = raw.indexOf("\n", lead);
		if (newline !== -1) return { start: newline + 1, fenced: true };
		return final ? { start: raw.length, fenced: true } : null;
	}
	if (!final && (rest === "" || "```".startsWith(rest))) return null;
	return { start: raw.startsWith("\r\n") ? 2 : raw.startsWith("\n") ? 1 : 0, fenced: false };
}

/** Length of `body` that can't change anymore: trailing whitespace and a possible closing fence are held back. */
function stableLength(body: string, fenced: boolean): number {
	let end = body.trimEnd().length;
	if (fenced) {
		const newline = body.lastIndexOf("\n", end - 1);
		if (newline !== -1 && /^[ \t]*`{1,3}$/.test(body.slice(newline + 1, end))) end = body.slice(0, newline).trimEnd().length;
	}
	return end;
}

/** Final file content: no tag newlines, no fence wrapper, exactly one trailing newline. */
function finalContent(body: string, fenced: boolean): string {
	let content = body.trimEnd();
	if (fenced) content = content.replace(/\n[ \t]*```$/, "").trimEnd();
	return content ? `${content}\n` : "";
}

/** Length of the longest suffix of `text` that is a proper prefix of `token`. */
function partialSuffix(text: string, token: string): number {
	for (let n = Math.min(token.length - 1, text.length); n > 0; n--) {
		if (token.startsWith(text.slice(text.length - n))) return n;
	}
	return 0;
}

export function createTextProtocolParser(): TextProtocolParser {
	let buffer = "";
	let file: OpenFile | null = null;
	let hasMessage = false;
	const written: string[] = [];
	const deleted: string[] = [];
	const truncated: string[] = [];

	function text(events: GenerationEvent[], value: string) {
		if (!value) return;
		if (value.trim()) hasMessage = true;
		const last = events[events.length - 1];
		if (last?.type === "message.delta") last.text += value;
		else events.push({ type: "message.delta", text: value });
	}

	function openFile(events: GenerationEvent[], attrs: Record<string, string>) {
		let path = attrs.path ? normalizePath(attrs.path) : null;
		if (!path && attrs.name) path = `${attrs.kind === "component" ? "components" : "screens"}/${toKebab(attrs.name)}.tsx`;
		file = { path, raw: "", sent: 0, body: null };
		if (!path) {
			events.push({ type: "status", label: "Ignored a file without a path" });
			return;
		}
		const kind = inferKind(path, attrs.kind);
		if (kind === "screen") {
			const screen: ScreenMeta = { name: attrs.name?.trim() || screenNameFromPath(path) };
			if (attrs.device === "mobile" || attrs.device === "desktop") screen.device = attrs.device as Device;
			events.push({ type: "file.start", path, kind, screen });
		} else {
			events.push({ type: "file.start", path, kind });
		}
	}

	/** Sends the stable part of the open file's content as a delta. */
	function flushFile(events: GenerationEvent[], final: boolean) {
		const current = file!;
		current.body ??= bodyStart(current.raw, final);
		if (!current.body || !current.path) return;
		const body = current.raw.slice(current.body.start);
		const clean = final ? finalContent(body, current.body.fenced) : body.slice(0, stableLength(body, current.body.fenced));
		if (clean.length > current.sent) {
			events.push({ type: "file.delta", path: current.path, text: clean.slice(current.sent) });
			current.sent = clean.length;
		}
	}

	/** Text state: returns false when it must wait for more input. */
	function stepText(events: GenerationEvent[]): boolean {
		const lt = buffer.indexOf("<");
		if (lt === -1) {
			text(events, buffer);
			buffer = "";
			return false;
		}
		text(events, buffer.slice(0, lt));
		buffer = buffer.slice(lt);

		for (const tag of TAGS) {
			if (buffer.length <= tag.length) {
				if (tag.startsWith(buffer)) return false; // could still become this tag
				continue;
			}
			if (!buffer.startsWith(tag)) continue;
			const next = buffer[tag.length]!;
			if (tag === CLOSE) {
				buffer = buffer.slice(tag.length); // stray closing tag: drop it
				return true;
			}
			if (!/[\s/>]/.test(next)) continue;
			const gt = buffer.indexOf(">");
			if (gt === -1) {
				if (buffer.length < MAX_TAG_LENGTH) return false;
				break;
			}
			const attrs = parseAttributes(buffer.slice(tag.length, gt).replace(/\/\s*$/, ""));
			buffer = buffer.slice(gt + 1);
			if (tag === OPEN) openFile(events, attrs);
			else if (attrs.path) {
				const path = normalizePath(attrs.path);
				deleted.push(path);
				events.push({ type: "file.delete", path });
			}
			return true;
		}
		// Not one of ours
		text(events, "<");
		buffer = buffer.slice(1);
		return true;
	}

	/** File state: returns false when it must wait for more input. */
	function stepFile(events: GenerationEvent[]): boolean {
		const current = file!;
		const close = buffer.indexOf(CLOSE);
		if (close === -1) {
			const keep = partialSuffix(buffer, CLOSE);
			current.raw += buffer.slice(0, buffer.length - keep);
			buffer = buffer.slice(buffer.length - keep);
			flushFile(events, false);
			return false;
		}
		current.raw += buffer.slice(0, close);
		buffer = buffer.slice(close + CLOSE.length);
		flushFile(events, true);
		if (current.path) {
			const body = current.body!;
			const content = finalContent(current.raw.slice(body.start), body.fenced);
			written.push(current.path);
			events.push({ type: "file.end", path: current.path, content });
		}
		file = null;
		return true;
	}

	return {
		push(chunk) {
			const events: GenerationEvent[] = [];
			buffer += chunk;
			while (buffer && (file ? stepFile(events) : stepText(events)));
			return events;
		},
		end() {
			const events: GenerationEvent[] = [];
			if (file) {
				const current: OpenFile = file;
				current.raw += buffer;
				buffer = "";
				flushFile(events, false);
				if (current.path) {
					truncated.push(current.path);
					events.push({ type: "status", label: TRUNCATED_STATUS, detail: current.path });
				}
				file = null;
			} else if (buffer && !/^<\/?rabisco-/.test(buffer)) {
				// An unfinished `<rabisco-…` tag is dropped; anything else was just text
				text(events, buffer);
			}
			buffer = "";
			return events;
		},
		get written() {
			return written;
		},
		get deleted() {
			return deleted;
		},
		get truncated() {
			return truncated;
		},
		get hasMessage() {
			return hasMessage;
		},
	};
}
