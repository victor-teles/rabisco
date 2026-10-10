import { formatPatch, structuredPatch } from "diff";
import type { Problem } from "./ai/contract";
import { DESIGN_RULES, type DesignFinding, type DesignRule } from "./design/findings";
import { isFiniteNumber, isString } from "./guards";
import { isJsonArray, isJsonObject, type Json } from "./json";
import type { FileChange, ProjectFiles } from "./types";

export type FileChangeKind = "added" | "modified" | "deleted";

export type ChangedFile = {
	path: string;
	change: FileChangeKind;
	/** Lines; `0` in summaries saved before counts existed */
	additions: number;
	deletions: number;
	/** Unified diff of the file; left out when it is too large to keep in the chat */
	patch?: string;
};

export type DesignNote = DesignFinding & { screen: string; path: string; version?: string };

/** What one generation did, shown under its reply */
export type ChangeSummary = {
	/** Sorted by path */
	files: ChangedFile[];
	/** Left out after automatic repairs */
	problems: number;
	design?: DesignNote[];
};

const CHANGE_KINDS: ReadonlySet<string> = new Set<FileChangeKind>(["added", "modified", "deleted"]);

/** A whole generated screen fits many times over; a pasted data file may not */
const MAX_PATCH_LENGTH = 200_000;

function fileChange(path: string, change: FileChangeKind, old: string, next: string): ChangedFile {
	const patch = structuredPatch(path, path, old, next);
	let additions = 0;
	let deletions = 0;

	for (const hunk of patch.hunks) {
		for (const line of hunk.lines) {
			if (line.startsWith("+")) additions++;
			else if (line.startsWith("-")) deletions++;
		}
	}

	const text = formatPatch(patch);

	return text.length > MAX_PATCH_LENGTH
		? { path, change, additions, deletions }
		: { path, change, additions, deletions, patch: text };
}

const count = (value: Json | undefined) => (isFiniteNumber(value) ? Math.max(0, Math.round(value)) : 0);

const isChangeKind = (value: string): value is FileChangeKind => CHANGE_KINDS.has(value);

const RULES: ReadonlySet<string> = new Set<DesignRule>(DESIGN_RULES);

const isRule = (value: string): value is DesignRule => RULES.has(value);

function parseDesignNote(value: Json): DesignNote | null {
	if (!isJsonObject(value) || !isString(value.rule) || !isRule(value.rule)) return null;

	if (!isString(value.message) || !isString(value.screen) || !isString(value.path)) return null;

	const severity = value.severity === "error" ? "error" : "warning";

	const note: DesignNote = {
		rule: value.rule,
		severity,
		message: value.message,
		screen: value.screen,
		path: value.path,
	};

	if (isFiniteNumber(value.start)) note.start = value.start;

	if (isFiniteNumber(value.line)) note.line = value.line;

	if (isString(value.version)) note.version = value.version;

	return note;
}

/** `null` when the run changed nothing and left no problems */
export function changeSummaryOf(
	before: ProjectFiles,
	changes: FileChange[],
	problems: Problem[],
): ChangeSummary | null {
	const files: ChangeSummary["files"] = [];

	for (const { path, content } of changes) {
		const existed = path in before;

		const old = before[path] ?? "";

		if (content === null) {
			if (existed) files.push(fileChange(path, "deleted", old, ""));
		} else if (!existed) files.push(fileChange(path, "added", "", content));
		else if (old !== content) files.push(fileChange(path, "modified", old, content));
	}

	if (!files.length && !problems.length) return null;

	return { files: files.sort((a, b) => a.path.localeCompare(b.path)), problems: problems.length };
}

/** Read from a saved chat line; anything malformed drops the whole summary */
export function parseChangeSummary(value: Json | undefined): ChangeSummary | undefined {
	if (!isJsonObject(value) || !isJsonArray(value.files) || !isFiniteNumber(value.problems)) return undefined;
	const files: ChangeSummary["files"] = [];

	for (const file of value.files) {
		if (!isJsonObject(file) || !isString(file.path) || !isString(file.change) || !isChangeKind(file.change))
			return undefined;

		const entry: ChangedFile = {
			path: file.path,
			change: file.change,
			additions: count(file.additions),
			deletions: count(file.deletions),
		};

		if (isString(file.patch)) entry.patch = file.patch;
		files.push(entry);
	}

	const summary: ChangeSummary = { files, problems: count(value.problems) };
	const design = isJsonArray(value.design) ? value.design.flatMap((note) => parseDesignNote(note) ?? []) : [];

	if (design.length) summary.design = design;

	return summary;
}
