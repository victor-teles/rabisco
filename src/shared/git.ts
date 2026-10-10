// Git sync: docs/decisions/0008-share-link-and-git-sync.md
import { CHATS_DIR, LEGACY_CHAT_FILE } from "./chats";
import { isComponentFile, isScreenFile, screenNameFromPath } from "./project";
import type { CanvasDoc, ProjectFiles } from "./types";

export type GitCommit = { hash: string; subject: string; date: string };

export type GitCheckpoint = { hash: string; short: string; name: string; date: string };

export type CheckpointVersion = { files: ProjectFiles; canvas: CanvasDoc };

export type GitStatus =
	| { state: "unavailable"; error: string }
	| { state: "none" }
	| {
			state: "repo";
			root: string;
			/** `""` when the project folder is the repository root */
			prefix: string;
			/** `null` when HEAD is detached */
			branch: string | null;
			hasCommits: boolean;
			/** Credentials removed from the URL */
			remote: { name: string; url: string } | null;
			/** e.g. `origin/main`; `null` before the first push */
			upstream: string | null;
			/** As of the last fetch */
			ahead: number;
			behind: number;
			/** Staged, unstaged or untracked */
			changes: number;
			lastCommit: GitCommit | null;
			unfinished: "rebase" | "merge" | null;
	  };

export type GitSyncResult =
	| {
			ok: true;
			committed: GitCommit | null;
			pulled: number;
			pushed: number;
			/** `null` when there is none (commit only) */
			remote: string | null;
			summary: string;
	  }
	| { ok: false; error: string; /** Git's own output */ detail?: string };

/** Git's one-letter status (`A`, `M`, `D`, `R`, `?`…); project-relative path */
export type ChangedPath = { status: string; path: string };

type Verb = "add" | "update" | "remove";

const verbOf = (status: string): Verb =>
	status === "A" || status === "?" ? "add" : status === "D" ? "remove" : "update";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** `screens/order-history.tsx` → `order history` */
const shortName = (path: string) => screenNameFromPath(path).toLowerCase();

const changeLines = (changes: ChangedPath[]) =>
	[...changes]
		.sort((a, b) => a.path.localeCompare(b.path))
		.map((change) => `- ${verbOf(change.status)} ${change.path}`)
		.join("\n");

/** e.g. `Rabisco: add 2 screens, update button component`, with a body listing the files */
export function commitMessage(changes: ChangedPath[]): string {
	const parts: string[] = [];

	const describe = (kind: "screen" | "component", test: (path: string) => boolean) => {
		const byVerb = new Map<Verb, string[]>();

		for (const change of changes) {
			if (!test(change.path)) continue;
			const verb = verbOf(change.status);
			byVerb.set(verb, [...(byVerb.get(verb) ?? []), change.path]);
		}

		for (const verb of ["add", "update", "remove"] as const) {
			const paths = byVerb.get(verb);

			if (!paths) continue;
			parts.push(
				paths.length === 1 ? `${verb} ${shortName(paths[0]!)} ${kind}` : `${verb} ${plural(paths.length, kind)}`,
			);
		}
	};

	describe("screen", isScreenFile);
	describe("component", isComponentFile);
	const paths = new Set(changes.map((change) => change.path));

	for (const file of ["PRODUCT.md", "DESIGN.md"]) if (paths.has(file)) parts.push(`update ${file}`);

	const known = (path: string) =>
		isScreenFile(path) || isComponentFile(path) || path === "PRODUCT.md" || path === "DESIGN.md";

	if (paths.has("rabisco.json")) parts.push("update the canvas");

	// Images attached to prompts belong to the chat
	const isChat = (path: string) =>
		path === LEGACY_CHAT_FILE || path.startsWith(`${CHATS_DIR}/`) || path.startsWith("attachments/");

	const others = [...paths].filter((path) => !known(path) && path !== "rabisco.json" && !isChat(path));

	if (others.length) parts.push(`update ${plural(others.length, "other file")}`);

	if (parts.length === 0 && [...paths].some(isChat)) parts.push("update the chat");

	if (parts.length === 0) parts.push("update the project");

	const shown = parts.length > 3 ? [...parts.slice(0, 3), "more"] : parts;
	const subject = `Rabisco: ${shown.join(", ")}`;

	return `${subject}\n\n${changeLines(changes)}\n`;
}

export const CHECKPOINT_TRAILER = "Rabisco-Checkpoint";

const CHECKPOINT_SUBJECT = "Rabisco checkpoint: ";

const NAME_LIMIT = 120;

export const CHECKPOINT_FORMAT = `%H%x00%h%x00%cI%x00%s%x00%(trailers:key=${CHECKPOINT_TRAILER},valueonly,separator=%x2C)%x1e`;

export const checkpointScope = (prefix: string) => prefix.replace(/\/+$/, "") || ".";

export const cleanCheckpointName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, NAME_LIMIT).trim();

export function checkpointMessage(name: string, changes: ChangedPath[], scope: string): string {
	const parts = [`${CHECKPOINT_SUBJECT}${cleanCheckpointName(name)}`];

	if (changes.length) parts.push(changeLines(changes));
	parts.push(`${CHECKPOINT_TRAILER}: ${scope}`);

	return `${parts.join("\n\n")}\n`;
}

export function parseCheckpoints(output: string, scope: string): GitCheckpoint[] {
	const checkpoints: GitCheckpoint[] = [];

	for (const record of output.split("\x1e")) {
		const [hash = "", short = "", date = "", subject = "", trailer = ""] = record.trim().split("\0");

		if (!hash || !subject.startsWith(CHECKPOINT_SUBJECT)) continue;

		if (!trailer.split(",").some((value) => value.trim() === scope)) continue;
		checkpoints.push({ hash, short, date, name: subject.slice(CHECKPOINT_SUBJECT.length) });
	}

	return checkpoints;
}

export function redactRemoteUrl(url: string): string {
	return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, "$1");
}
