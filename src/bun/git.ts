/**
 * Sync to a git repository (decision 0008), with the system `git` CLI in the
 * project folder. Everything is scoped to the project folder, so a project
 * inside a bigger repository only stages and commits its own files.
 *
 * Git never prompts (`GIT_TERMINAL_PROMPT=0`, SSH in batch mode), every call
 * has a timeout, sync never force-pushes, and a failed rebase is aborted so the
 * repository is left as it was, with Rabisco's commit kept locally.
 */
import { existsSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import {
	commitMessage,
	redactRemoteUrl,
	type ChangedPath,
	type GitCommit,
	type GitStatus,
	type GitSyncResult,
} from "../shared/git";
import { cliEnv, resolveBinary } from "./ai/cli";

export type GitResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

export type GitOptions = {
	/** The git binary; found on PATH and in common folders when omitted. `null` acts as if git were missing (tests). */
	bin?: string | null;
	/** Local commands */
	timeoutMs?: number;
	/** fetch and push */
	networkTimeoutMs?: number;
};

const GITIGNORE = ".DS_Store\n";

const MISSING_GIT =
	"Git isn't installed. Install it from git-scm.com (on a Mac, run `xcode-select --install` in Terminal), then try again.";

/** A git failure, with git's own output for the details. */
export class GitError extends Error {
	constructor(
		message: string,
		readonly detail?: string,
	) {
		super(message);
		this.name = "GitError";
	}
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Parses `git status --porcelain=v1 -z`: root-relative paths with their one-letter status. */
export function parsePorcelain(output: string): ChangedPath[] {
	const entries = output.split("\0");
	const changes: ChangedPath[] = [];

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]!;

		if (entry.length < 4) continue;
		const xy = entry.slice(0, 2);
		const path = entry.slice(3);

		// Renames and copies are followed by the old path
		if (xy[0] === "R" || xy[0] === "C") i++;

		const status =
			xy === "??" ? "?" : xy.includes("D") ? "D" : xy.includes("A") ? "A" : xy[0] === "R" || xy[1] === "R" ? "R" : "M";

		changes.push({ status, path });
	}

	return changes;
}

const output = (result: GitResult) => [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");

/** What went wrong talking to a remote, in words a designer can act on. */
function remoteFailure(action: string, remote: string, result: GitResult): GitError {
	const text = output(result);

	if (result.timedOut)
		return new GitError(
			`Git took too long to ${action} ${remote} and was stopped. Check your connection and try again.`,
			text,
		);

	if (
		/authentication failed|could not read (username|password)|terminal prompts disabled|permission denied|access denied|403|401/i.test(
			text,
		)
	) {
		return new GitError(
			`Git couldn't sign in to ${remote}. Make sure you can ${action === "push to" ? "push" : "pull"} from a terminal (saved credentials or an SSH key), then sync again.`,
			text,
		);
	}

	if (/repository not found|does not appear to be a git repository|not found/i.test(text)) {
		return new GitError(`Git couldn't find the repository at ${remote}. Check the remote URL.`, text);
	}

	if (/could not resolve host|unable to access|connection (refused|timed out)|network is unreachable/i.test(text)) {
		return new GitError(`Git couldn't reach ${remote}. Check your connection and the remote URL.`, text);
	}

	if (/rejected|non-fast-forward|fetch first/i.test(text)) {
		return new GitError(`${remote} has changes that arrived while syncing. Sync again to bring them in first.`, text);
	}

	return new GitError(`Git couldn't ${action} ${remote}.`, text);
}

/** Git for project folders. Independent of Electrobun so it can be tested with real repositories. */
export function createGit(options: GitOptions = {}) {
	const timeoutMs = options.timeoutMs ?? 20_000;
	const networkTimeoutMs = options.networkTimeoutMs ?? 90_000;
	let checked: { bin: string } | { error: string } | null = null;

	async function spawn(bin: string, cwd: string, args: string[], timeout: number): Promise<GitResult> {
		const proc = Bun.spawn([bin, "-c", "color.ui=false", "-c", "core.quotepath=false", ...args], {
			cwd,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: cliEnv(bin, {
				// Never wait for a password nobody can type
				GIT_TERMINAL_PROMPT: "0",
				GCM_INTERACTIVE: "never",
				GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
				// No editor for commits and rebases
				GIT_EDITOR: "true",
				GIT_SEQUENCE_EDITOR: "true",
				GIT_MERGE_AUTOEDIT: "no",
				// Messages Rabisco can recognise
				LC_ALL: "C",
				LANG: "C",
			}),
		});

		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill();
		}, timeout);

		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		clearTimeout(timer);

		return { code: timedOut ? -1 : code, stdout, stderr, timedOut };
	}

	/** The git binary, checked once: macOS ships a `/usr/bin/git` stub that only works with the command line tools. */
	async function binary(): Promise<string> {
		if (!checked) {
			const bin = options.bin === undefined ? resolveBinary("git") : options.bin;

			if (!bin) checked = { error: MISSING_GIT };
			else {
				try {
					const version = await spawn(bin, process.cwd(), ["--version"], timeoutMs);
					checked =
						version.code === 0
							? { bin }
							: {
									error: /xcrun|developer tools|command line tools/i.test(output(version))
										? MISSING_GIT
										: `Git doesn't work: ${output(version)}`,
								};
				} catch {
					checked = { error: MISSING_GIT };
				}
			}
		}

		if ("error" in checked) throw new GitError(checked.error);

		return checked.bin;
	}

	/** Runs git in `cwd`; resolves with the exit code instead of throwing. */
	async function run(cwd: string, args: string[], timeout = timeoutMs) {
		return spawn(await binary(), cwd, args, timeout);
	}

	/** Runs git in `cwd` and returns stdout; throws a `GitError` with `message` when it fails. */
	async function must(cwd: string, args: string[], message: string, timeout = timeoutMs) {
		const result = await run(cwd, args, timeout);

		if (result.code !== 0) throw new GitError(message, output(result));

		return result.stdout;
	}

	const ok = async (cwd: string, args: string[]) => (await run(cwd, args)).code === 0;

	const line = async (cwd: string, args: string[]) => {
		const result = await run(cwd, args);

		return result.code === 0 ? result.stdout.trim() : null;
	};

	/** Changed files of the project folder, project-relative. */
	async function changedPaths(dir: string, prefix: string): Promise<ChangedPath[]> {
		const porcelain = await must(
			dir,
			["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."],
			"Git couldn't read the project's changes.",
		);

		return parsePorcelain(porcelain).map((change) => ({
			...change,
			path: prefix && change.path.startsWith(prefix) ? change.path.slice(prefix.length) : change.path,
		}));
	}

	async function lastCommit(dir: string, ref = "HEAD", scoped = true): Promise<GitCommit | null> {
		const text = await line(dir, ["log", "-1", "--format=%h%x00%s%x00%cI", ref, ...(scoped ? ["--", "."] : [])]);

		if (!text) return null;
		const [hash = "", subject = "", date = ""] = text.split("\0");

		return { hash, subject, date };
	}

	async function count(dir: string, range: string) {
		return Number((await line(dir, ["rev-list", "--count", range])) ?? 0) || 0;
	}

	async function status(dir: string): Promise<GitStatus> {
		try {
			await binary();
		} catch (error) {
			return { state: "unavailable", error: messageOf(error) };
		}

		if (!existsSync(dir)) throw new GitError(`Folder not found: ${dir}`);
		const root = await line(dir, ["rev-parse", "--show-toplevel"]);

		if (root === null) return { state: "none" };
		const prefix = (await line(dir, ["rev-parse", "--show-prefix"])) ?? "";
		const branch = await line(dir, ["symbolic-ref", "--short", "-q", "HEAD"]);
		const hasCommits = await ok(dir, ["rev-parse", "--verify", "-q", "HEAD"]);

		const upstream = branch
			? await line(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
			: null;

		const remotes = ((await line(dir, ["remote"])) ?? "").split("\n").filter(Boolean);
		const configured = branch ? await line(dir, ["config", "--get", `branch.${branch}.remote`]) : null;

		const remoteName =
			[configured, "origin", remotes[0]].find((name): name is string => !!name && remotes.includes(name)) ?? null;

		const remoteUrl = remoteName ? await line(dir, ["remote", "get-url", remoteName]) : null;
		let ahead = 0;
		let behind = 0;

		if (upstream && hasCommits) {
			const [left = "0", right = "0"] = (
				(await line(dir, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])) ?? ""
			).split(/\s+/);

			ahead = Number(left) || 0;
			behind = Number(right) || 0;
		}

		const gitPath = async (name: string) => {
			const path = await line(dir, ["rev-parse", "--git-path", name]);

			return !!path && existsSync(resolve(dir, path));
		};

		const unfinished =
			(await gitPath("rebase-merge")) || (await gitPath("rebase-apply"))
				? "rebase"
				: (await gitPath("MERGE_HEAD"))
					? "merge"
					: null;

		return {
			state: "repo",
			root,
			prefix,
			branch,
			hasCommits,
			remote: remoteName ? { name: remoteName, url: redactRemoteUrl(remoteUrl ?? "") } : null,
			upstream,
			ahead,
			behind,
			changes: (await changedPaths(dir, prefix)).length,
			lastCommit: hasCommits ? await lastCommit(dir) : null,
			unfinished,
		};
	}

	/** Stages the project folder and commits it, when it has changes. */
	async function commitProject(dir: string, prefix: string, message?: string): Promise<GitCommit | null> {
		const changes = await changedPaths(dir, prefix);

		if (changes.length === 0) return null;
		await must(dir, ["add", "-A", "--", "."], "Git couldn't stage the project's files.");
		// `-- .` commits only the project folder, whatever else is staged in the repository
		const result = await run(dir, ["commit", "--no-verify", "-q", "-m", message ?? commitMessage(changes), "--", "."]);

		if (result.code !== 0) {
			const text = output(result);

			if (/tell me who you are|empty ident|user\.email|user\.name/i.test(text)) {
				throw new GitError(
					'Git doesn\'t know who you are yet. In Terminal, run `git config --global user.name "Your Name"` and `git config --global user.email you@example.com`, then sync again.',
					text,
				);
			}

			throw new GitError("Git couldn't commit the project's changes.", text);
		}

		return lastCommit(dir, "HEAD", false);
	}

	/** Makes the project folder a repository with a first commit. */
	async function init(dir: string, name: string): Promise<GitStatus> {
		const current = await status(dir);

		if (current.state === "unavailable") throw new GitError(current.error);

		if (current.state === "repo") throw new GitError(`This project is already in a git repository (${current.root}).`);
		await must(dir, ["init", "-q"], "Git couldn't create a repository here.");
		// `init -b` needs git 2.28; this works everywhere
		await must(dir, ["symbolic-ref", "HEAD", "refs/heads/main"], "Git couldn't name the branch.");

		if (!existsSync(join(dir, ".gitignore"))) writeFileSync(join(dir, ".gitignore"), GITIGNORE);
		await commitProject(dir, "", `Rabisco: start ${name.trim() || "the project"}`);

		return status(dir);
	}

	/** Points the repository's remote (`origin`, or the one sync uses) at `url`. */
	async function setRemote(dir: string, rawUrl: string): Promise<GitStatus> {
		const url = rawUrl.trim();

		// A URL that starts with "-" would be read as an option
		if (!url || url.startsWith("-") || /[\s\0]/.test(url))
			throw new GitError("Enter a repository URL, like https://github.com/you/app.git or git@github.com:you/app.git.");
		const current = await status(dir);

		if (current.state !== "repo")
			throw new GitError(current.state === "unavailable" ? current.error : "Set up git for this project first.");
		const name = current.remote?.name ?? "origin";

		if (current.remote) await must(dir, ["remote", "set-url", name, url], "Git couldn't change the remote.");
		else await must(dir, ["remote", "add", name, url], "Git couldn't add the remote.");

		return status(dir);
	}

	/** Commit, then bring in the remote's commits (rebase) and push. Never forces. */
	async function sync(dir: string): Promise<GitSyncResult> {
		try {
			const before = await status(dir);

			if (before.state === "unavailable") return { ok: false, error: before.error };

			if (before.state === "none")
				return { ok: false, error: "This project isn't in a git repository yet. Set up git first." };

			if (before.unfinished) {
				return {
					ok: false,
					error: `A ${before.unfinished} is in progress in this repository. Finish or abort it in a terminal, then sync again.`,
				};
			}

			if (!before.branch)
				return {
					ok: false,
					error: "The repository isn't on a branch (detached HEAD). Check out a branch in a terminal, then sync again.",
				};
			const branch = before.branch;

			const committed = await commitProject(dir, before.prefix);
			const remote = before.remote?.name ?? null;

			if (!remote) {
				return {
					ok: true,
					committed,
					pulled: 0,
					pushed: 0,
					remote: null,
					summary: committed
						? "Committed your changes. Add a remote to back them up online."
						: "Nothing new to commit. Add a remote to back the project up online.",
				};
			}

			const keptLocally = committed ? " Your changes are committed locally." : "";
			const fetched = await run(dir, ["fetch", "-q", remote], networkTimeoutMs);

			if (fetched.code !== 0) {
				const error = remoteFailure("pull from", remote, fetched);

				return { ok: false, error: error.message + keptLocally, detail: error.detail };
			}

			// The upstream, or the remote's branch of the same name before the first push
			const remoteBranch = before.upstream?.startsWith(`${remote}/`)
				? before.upstream.slice(remote.length + 1)
				: branch;

			const target =
				before.upstream ??
				((await ok(dir, ["rev-parse", "--verify", "-q", `refs/remotes/${remote}/${branch}`]))
					? `${remote}/${branch}`
					: null);

			const hasCommits = await ok(dir, ["rev-parse", "--verify", "-q", "HEAD"]);

			let pulled = 0;

			if (target) {
				pulled = hasCommits ? await count(dir, `HEAD..${target}`) : await count(dir, target);

				if (pulled > 0) {
					const result = hasCommits
						? await run(dir, ["rebase", "-q", target])
						: await run(dir, ["merge", "-q", "--ff-only", target]);

					if (result.code !== 0) {
						const text = output(result);

						// Put everything back as it was before the rebase
						if (hasCommits) await run(dir, ["rebase", "--abort"]);
						const conflict = /conflict/i.test(text);

						return {
							ok: false,
							error: conflict
								? `Your changes and the changes on ${remote} edit the same lines, so Rabisco stopped and left everything as it was.${keptLocally} Resolve it in a terminal (git pull --rebase), then sync again.`
								: `Git couldn't bring in the changes from ${remote}, so Rabisco left everything as it was.${keptLocally}`,
							detail: text,
						};
					}
				}
			}

			const nowHasCommits = hasCommits || pulled > 0;
			const pushed = !nowHasCommits ? 0 : target ? await count(dir, `${target}..HEAD`) : await count(dir, "HEAD");

			if (pushed > 0 || (nowHasCommits && !before.upstream)) {
				const args = before.upstream
					? ["push", "-q", remote, `HEAD:refs/heads/${remoteBranch}`]
					: ["push", "-q", "-u", remote, `HEAD:refs/heads/${branch}`];

				const result = await run(dir, args, networkTimeoutMs);

				if (result.code !== 0) {
					const error = remoteFailure("push to", remote, result);

					return { ok: false, error: error.message + keptLocally, detail: error.detail };
				}

				if (!before.upstream) await run(dir, ["branch", "-q", `--set-upstream-to=${remote}/${branch}`]);
			}

			const parts = [
				committed ? "committed your changes" : null,
				pulled ? `brought in ${pulled} ${pulled === 1 ? "commit" : "commits"}` : null,
				pushed ? `pushed ${pushed} ${pushed === 1 ? "commit" : "commits"}` : null,
			].filter(Boolean);

			const summary = parts.length
				? `${parts.join(", ").replace(/^./, (ch) => ch.toUpperCase())}.`
				: `Up to date with ${remote}.`;

			return { ok: true, committed, pulled, pushed, remote, summary };
		} catch (error) {
			return { ok: false, error: messageOf(error), detail: error instanceof GitError ? error.detail : undefined };
		}
	}

	return { status, init, setRemote, sync, run };
}

export type Git = ReturnType<typeof createGit>;
