// Git sync: docs/decisions/0008-share-link-and-git-sync.md
import { isComponentFile, isScreenFile, screenNameFromPath } from "./project";

export type GitCommit = { hash: string; subject: string; date: string };

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
	const isChat = (path: string) => path === "chat.jsonl" || path.startsWith("attachments/");
	const others = [...paths].filter((path) => !known(path) && path !== "rabisco.json" && !isChat(path));

	if (others.length) parts.push(`update ${plural(others.length, "other file")}`);

	if (parts.length === 0 && [...paths].some(isChat)) parts.push("update the chat");

	if (parts.length === 0) parts.push("update the project");

	const shown = parts.length > 3 ? [...parts.slice(0, 3), "more"] : parts;
	const subject = `Rabisco: ${shown.join(", ")}`;

	const body = [...changes]
		.sort((a, b) => a.path.localeCompare(b.path))
		.map((change) => `- ${verbOf(change.status)} ${change.path}`)
		.join("\n");

	return `${subject}\n\n${body}\n`;
}

export function redactRemoteUrl(url: string): string {
	return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, "$1");
}
