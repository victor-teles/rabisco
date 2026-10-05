/**
 * Git sync (decision 0008): types shared by the main process (`src/bun/git.ts`)
 * and the Share dialog, and the commit message Rabisco writes.
 */
import { isComponentFile, isScreenFile, screenNameFromPath } from "./project";

export type GitCommit = { hash: string; subject: string; date: string };

export type GitStatus =
	/** No usable `git` on this computer */
	| { state: "unavailable"; error: string }
	/** The project folder isn't in a repository */
	| { state: "none" }
	| {
			state: "repo";
			/** Top folder of the repository: the project folder, or a folder above it */
			root: string;
			/** The project's path inside the repository, `""` when it is the root */
			prefix: string;
			/** `null` when HEAD is detached */
			branch: string | null;
			hasCommits: boolean;
			/** The remote sync uses, with credentials removed from the URL */
			remote: { name: string; url: string } | null;
			/** e.g. `origin/main`; `null` before the first push */
			upstream: string | null;
			/** Commits not pushed / not pulled yet, as of the last fetch */
			ahead: number;
			behind: number;
			/** Changed files in the project folder (staged, unstaged or untracked) */
			changes: number;
			/** The last commit that touched the project folder */
			lastCommit: GitCommit | null;
			/** A rebase or merge someone started and didn't finish */
			unfinished: "rebase" | "merge" | null;
	  };

export type GitSyncResult =
	| {
			ok: true;
			/** The commit Rabisco made for local changes, if there were any */
			committed: GitCommit | null;
			/** Commits brought in from the remote */
			pulled: number;
			/** Commits pushed to the remote */
			pushed: number;
			/** Remote used, `null` when there is none (commit only) */
			remote: string | null;
			/** One sentence for a toast */
			summary: string;
	  }
	| { ok: false; error: string; /** Git's own output */ detail?: string };

/** One changed path, project-relative, with git's one-letter status (`A`, `M`, `D`, `R`, `?`…). */
export type ChangedPath = { status: string; path: string };

type Verb = "add" | "update" | "remove";

const verbOf = (status: string): Verb => (status === "A" || status === "?" ? "add" : status === "D" ? "remove" : "update");

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** `screens/order-history.tsx` → `order history` */
const shortName = (path: string) => screenNameFromPath(path).toLowerCase();

/**
 * The commit message for `changes`: a subject like `Rabisco: add 2 screens,
 * update button component` and a body that lists the files.
 */
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
			parts.push(paths.length === 1 ? `${verb} ${shortName(paths[0]!)} ${kind}` : `${verb} ${plural(paths.length, kind)}`);
		}
	};
	describe("screen", isScreenFile);
	describe("component", isComponentFile);
	const paths = new Set(changes.map((change) => change.path));
	for (const file of ["PRODUCT.md", "DESIGN.md"]) if (paths.has(file)) parts.push(`update ${file}`);
	const known = (path: string) => isScreenFile(path) || isComponentFile(path) || path === "PRODUCT.md" || path === "DESIGN.md";
	if (paths.has("rabisco.json")) parts.push("update the canvas");
	const others = [...paths].filter((path) => !known(path) && path !== "rabisco.json" && path !== "chat.jsonl");
	if (others.length) parts.push(`update ${plural(others.length, "other file")}`);
	if (parts.length === 0 && paths.has("chat.jsonl")) parts.push("update the chat");
	if (parts.length === 0) parts.push("update the project");

	const shown = parts.length > 3 ? [...parts.slice(0, 3), "more"] : parts;
	const subject = `Rabisco: ${shown.join(", ")}`;
	const body = [...changes]
		.sort((a, b) => a.path.localeCompare(b.path))
		.map((change) => `- ${verbOf(change.status)} ${change.path}`)
		.join("\n");
	return `${subject}\n\n${body}\n`;
}

/** A remote URL without the user name and password (`https://token@github.com/…` → `https://github.com/…`). */
export function redactRemoteUrl(url: string): string {
	return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, "$1");
}
