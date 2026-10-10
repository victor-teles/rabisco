// Decision 0003. Chunks may split anything anywhere, tag names included; providers emit `done`/`error`.

import type { FileKind, GenerationEvent, ProjectFile, ScreenMeta } from "../../shared/ai/contract";
import { isDevice, screenNameFromPath, toKebab } from "../../shared/project";
import { applyEditBlocks, parseEditBlocks } from "./edit-blocks";

const OPEN = "<rabisco-file";

const CLOSE = "</rabisco-file>";

const EDIT_OPEN = "<rabisco-edit";

const EDIT_CLOSE = "</rabisco-edit>";

const DELETE = "<rabisco-delete";

const TAGS = [OPEN, EDIT_OPEN, DELETE, CLOSE, EDIT_CLOSE];

/** An unterminated `<rabisco-file …` longer than this is treated as plain text */
const MAX_TAG_LENGTH = 2000;

/** For a file still open when the stream ended; `detail` is its path. */
export const TRUNCATED_STATUS = "File cut off";

export const EDIT_MISMATCH_STATUS = "Edit didn't match";

export type TextProtocolParser = {
	push(chunk: string): GenerationEvent[];
	/** A file still open gets a `status` instead of `file.end`. */
	end(): GenerationEvent[];
	readonly written: readonly string[];
	readonly deleted: readonly string[];
	/** The caller should turn these into repair problems */
	readonly truncated: readonly string[];
	readonly unmatched: readonly string[];
	readonly hasMessage: boolean;
};

type OpenFile = {
	/** null: no usable path; content is swallowed */
	path: string | null;
	raw: string;
	sent: number;
	body: { start: number; fenced: boolean } | null;
};

type OpenEdit = {
	path: string | null;
	kind: FileKind;
	raw: string;
};

const ENTITIES = new Map([
	["&quot;", '"'],
	["&apos;", "'"],
	["&lt;", "<"],
	["&gt;", ">"],
	["&amp;", "&"],
]);

export function parseAttributes(source: string): Record<string, string> {
	const matches = source.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`/]+))/g);

	return Object.fromEntries(
		Array.from(matches, (m) => [
			m[1]!.toLowerCase(),
			(m[2] ?? m[3] ?? m[4] ?? "").replace(/&(?:quot|apos|lt|gt|amp);/g, (e) => ENTITIES.get(e) ?? e),
		]),
	);
}

const normalizePath = (path: string) =>
	path
		.trim()
		.replace(/\\/g, "/")
		.replace(/^(?:\.\/|\/)+/, "");

export const inferKind = (path: string, kind?: string): FileKind =>
	kind === "screen" || kind === "component" || kind === "context"
		? kind
		: path.startsWith("components/")
			? "component"
			: /\.md$/i.test(path)
				? "context"
				: "screen";

/** After the tag's newline and any ```tsx fence line; null when not known yet. */
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

/** Holds back trailing whitespace and a possible closing fence. */
function stableLength(body: string, fenced: boolean): number {
	let end = body.trimEnd().length;

	if (fenced) {
		const newline = body.lastIndexOf("\n", end - 1);

		if (newline !== -1 && /^[ \t]*`{1,3}$/.test(body.slice(newline + 1, end)))
			end = body.slice(0, newline).trimEnd().length;
	}

	return end;
}

function finalContent(body: string, fenced: boolean): string {
	let content = body.trimEnd();

	if (fenced) content = content.replace(/\n[ \t]*```$/, "").trimEnd();

	return content ? `${content}\n` : "";
}

function partialSuffix(text: string, token: string): number {
	for (let n = Math.min(token.length - 1, text.length); n > 0; n--) {
		if (token.startsWith(text.slice(text.length - n))) return n;
	}

	return 0;
}

export function createTextProtocolParser(files: readonly ProjectFile[] = []): TextProtocolParser {
	let buffer = "";
	let file: OpenFile | null = null;
	let edit: OpenEdit | null = null;
	let hasMessage = false;
	const written: string[] = [];
	const deleted: string[] = [];
	const truncated: string[] = [];
	const unmatched: string[] = [];
	const contents = new Map(files.map((entry) => [entry.path, entry.content]));

	function text(events: GenerationEvent[], value: string) {
		if (!value) return;

		if (value.trim()) hasMessage = true;
		const last = events[events.length - 1];

		if (last?.type === "message.delta") last.text += value;
		else events.push({ type: "message.delta", text: value });
	}

	function openFile(events: GenerationEvent[], attrs: Record<string, string>) {
		let path = attrs.path ? normalizePath(attrs.path) : null;

		if (!path && attrs.name)
			path = `${attrs.kind === "component" ? "components" : "screens"}/${toKebab(attrs.name)}.tsx`;
		file = { path, raw: "", sent: 0, body: null };

		if (!path) {
			events.push({ type: "status", label: "Ignored a file without a path" });

			return;
		}

		const kind = inferKind(path, attrs.kind);

		if (kind === "screen") {
			const screen: ScreenMeta = { name: attrs.name?.trim() || screenNameFromPath(path) };

			const device = attrs.device;

			if (isDevice(device)) screen.device = device;
			events.push({ type: "file.start", path, kind, screen });
		} else {
			events.push({ type: "file.start", path, kind });
		}
	}

	function flushFile(events: GenerationEvent[], final: boolean) {
		const current = file!;
		current.body ??= bodyStart(current.raw, final);

		if (!current.body || !current.path) return;
		const body = current.raw.slice(current.body.start);

		const clean = final
			? finalContent(body, current.body.fenced)
			: body.slice(0, stableLength(body, current.body.fenced));

		if (clean.length > current.sent) {
			events.push({ type: "file.delta", path: current.path, text: clean.slice(current.sent) });
			current.sent = clean.length;
		}
	}

	/** false: wait for more input */
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
				if (tag.startsWith(buffer)) return false;
				continue;
			}

			if (!buffer.startsWith(tag)) continue;
			const next = buffer[tag.length]!;

			if (tag === CLOSE || tag === EDIT_CLOSE) {
				buffer = buffer.slice(tag.length);

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
			else if (tag === EDIT_OPEN) openEdit(events, attrs);
			else if (attrs.path) {
				const path = normalizePath(attrs.path);
				deleted.push(path);
				contents.delete(path);
				events.push({ type: "file.delete", path });
			}

			return true;
		}

		text(events, "<");
		buffer = buffer.slice(1);

		return true;
	}

	/** false: wait for more input */
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
			contents.set(current.path, content);
			events.push({ type: "file.end", path: current.path, content });
		}

		file = null;

		return true;
	}

	function openEdit(events: GenerationEvent[], attrs: Record<string, string>) {
		const path = attrs.path ? normalizePath(attrs.path) : null;
		edit = { path, kind: path ? inferKind(path, attrs.kind) : "screen", raw: "" };

		events.push(
			path ? { type: "status", label: `Editing ${path}` } : { type: "status", label: "Ignored an edit without a path" },
		);
	}

	function finishEdit(events: GenerationEvent[], closed: boolean) {
		const open = edit!;
		edit = null;

		if (!open.path) return;
		const blocks = closed ? parseEditBlocks(open.raw) : null;
		const base = contents.get(open.path);
		const result = blocks && base !== undefined ? applyEditBlocks(base, blocks) : null;

		if (!result?.ok) {
			unmatched.push(open.path);
			events.push({ type: "status", label: EDIT_MISMATCH_STATUS, detail: open.path });

			return;
		}

		written.push(open.path);
		contents.set(open.path, result.content);
		events.push({ type: "file.start", path: open.path, kind: open.kind });
		events.push({ type: "file.end", path: open.path, content: result.content });
	}

	function stepEdit(events: GenerationEvent[]): boolean {
		const open = edit!;
		const close = buffer.indexOf(EDIT_CLOSE);

		if (close === -1) {
			const keep = partialSuffix(buffer, EDIT_CLOSE);
			open.raw += buffer.slice(0, buffer.length - keep);
			buffer = buffer.slice(buffer.length - keep);

			return false;
		}

		open.raw += buffer.slice(0, close);
		buffer = buffer.slice(close + EDIT_CLOSE.length);
		finishEdit(events, true);

		return true;
	}

	return {
		push(chunk) {
			const events: GenerationEvent[] = [];
			buffer += chunk;

			while (buffer && (file ? stepFile(events) : edit ? stepEdit(events) : stepText(events)));

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
			} else if (edit) {
				finishEdit(events, false);
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
		get unmatched() {
			return unmatched;
		},
		get hasMessage() {
			return hasMessage;
		},
	};
}
