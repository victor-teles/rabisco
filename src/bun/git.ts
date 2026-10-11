// Decision 0008. Scoped to the project folder; never prompts, never force-pushes, aborts failed rebases.
import { existsSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import {
	CHECKPOINT_FORMAT,
	CHECKPOINT_TRAILER,
	checkpointMessage,
	checkpointScope,
	cleanCheckpointName,
	commitMessage,
	parseCheckpoints,
	redactRemoteUrl,
	type ChangedPath,
	type CheckpointVersion,
	type GitCheckpoint,
	type GitCommit,
	type GitStatus,
	type GitSyncResult,
} from "../shared/git";
import { emptyCanvas, isProjectFile, projectNameFromPath, reconcileFrames } from "../shared/project";
import type { CanvasDoc, ProjectFiles } from "../shared/types";
import { cliEnv, resolveBinary } from "./ai/cli";
import { parseJson } from "./json";
import { CANVAS_FILE, normalizeCanvas } from "./project-folder";

export type GitResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

export type GitOptions = {
	/** `null` acts as if git were missing (tests) */
	bin?: string | null;
	timeoutMs?: number;
	/** fetch and push */
	networkTimeoutMs?: number;
};

const GITIGNORE = ".DS_Store\n";

const MISSING_GIT =
	"Git isn't installed. Install it from git-scm.com (on a Mac, run `xcode-select --install` in Terminal), then try again.";

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

const CHECKPOINT_LIMIT = 100;

const isCommitHash = (hash: string) => /^[0-9a-f]{7,64}$/i.test(hash);

function commitFailure(text: string, again: string) {
	if (/tell me who you are|empty ident|user\.email|user\.name/i.test(text)) {
		return new GitError(
			`Git doesn't know who you are yet. In Terminal, run \`git config --global user.name "Your Name"\` and \`git config --global user.email you@example.com\`, then ${again}.`,
			text,
		);
	}

	return new GitError("Git couldn't commit the project's changes.", text);
}

function versionCanvas(dir: string, text: string | undefined, files: ProjectFiles): CanvasDoc {
	const name = projectNameFromPath(dir);
	let canvas = emptyCanvas(name, "mobile");

	if (text !== undefined) {
		try {
			canvas = normalizeCanvas(parseJson(text), name);
		} catch {}
	}

	return reconcileFrames(canvas, files);
}

/** Parses `git status --porcelain=v1 -z`; paths are root-relative. */
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
				GIT_EDITOR: "true",
				GIT_SEQUENCE_EDITOR: "true",
				GIT_MERGE_AUTOEDIT: "no",
				// Untranslated messages, so the regexes match
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

	// macOS ships a `/usr/bin/git` stub that only works with the command line tools
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
				} catch (error) {
					checked = {
						error:
							error instanceof Error && "code" in error && error.code === "ENOENT"
								? MISSING_GIT
								: `Git doesn't work: ${messageOf(error)}`,
					};
				}
			}
		}

		if ("error" in checked) throw new GitError(checked.error);

		return checked.bin;
	}

	async function run(cwd: string, args: string[], timeout = timeoutMs) {
		return spawn(await binary(), cwd, args, timeout);
	}

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
		const top = await run(dir, ["rev-parse", "--show-toplevel"]);

		if (top.code !== 0) {
			return /not a git repository/i.test(output(top))
				? { state: "none" }
				: { state: "unavailable", error: `Git couldn't read the repository: ${output(top) || "it timed out"}` };
		}

		const root = top.stdout.trim();
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

	async function commitProject(dir: string, prefix: string, message?: string): Promise<GitCommit | null> {
		const changes = await changedPaths(dir, prefix);

		if (changes.length === 0) return null;
		await must(dir, ["add", "-A", "--", "."], "Git couldn't stage the project's files.");
		// `-- .` commits only the project folder, whatever else is staged in the repository
		const result = await run(dir, ["commit", "--no-verify", "-q", "-m", message ?? commitMessage(changes), "--", "."]);

		if (result.code !== 0) throw commitFailure(output(result), "sync again");

		return lastCommit(dir, "HEAD", false);
	}

	async function checkpoints(dir: string): Promise<GitCheckpoint[]> {
		const prefix = await line(dir, ["rev-parse", "--show-prefix"]);

		if (prefix === null || !(await ok(dir, ["rev-parse", "--verify", "-q", "HEAD"]))) return [];
		const scope = checkpointScope(prefix);

		const text = await must(
			dir,
			[
				"log",
				`-n${CHECKPOINT_LIMIT}`,
				"--fixed-strings",
				`--grep=${CHECKPOINT_TRAILER}: ${scope}`,
				`--format=${CHECKPOINT_FORMAT}`,
				"HEAD",
			],
			"Git couldn't read the checkpoints.",
		);

		return parseCheckpoints(text, scope);
	}

	async function checkpoint(dir: string, rawName: string): Promise<GitCheckpoint> {
		const name = cleanCheckpointName(rawName);

		if (!name) throw new GitError("Name the checkpoint.");
		const current = await status(dir);

		if (current.state !== "repo")
			throw new GitError(current.state === "unavailable" ? current.error : "Set up git for this project first.");

		if (current.unfinished) {
			throw new GitError(
				`A ${current.unfinished} is in progress in this repository. Finish or abort it in a terminal, then save the checkpoint again.`,
			);
		}

		if (!current.branch)
			throw new GitError(
				"The repository isn't on a branch (detached HEAD). Check out a branch in a terminal, then save the checkpoint again.",
			);
		const scope = checkpointScope(current.prefix);
		const changes = await changedPaths(dir, current.prefix);

		if (changes.length) await must(dir, ["add", "-A", "--", "."], "Git couldn't stage the project's files.");

		const result = await run(dir, [
			"commit",
			"--no-verify",
			"--allow-empty",
			"-q",
			"-m",
			checkpointMessage(name, changes, scope),
			"--",
			".",
		]);

		if (result.code !== 0) throw commitFailure(output(result), "save the checkpoint again");

		const [saved] = parseCheckpoints(
			await must(dir, ["log", "-1", `--format=${CHECKPOINT_FORMAT}`, "HEAD"], "Git couldn't read the checkpoint."),
			scope,
		);

		if (!saved) throw new GitError("Git couldn't read the checkpoint.");

		return saved;
	}

	async function readCheckpoint(dir: string, hash: string): Promise<CheckpointVersion> {
		if (!isCommitHash(hash)) throw new GitError("That checkpoint isn't in this repository.");

		const listing = await must(
			dir,
			["ls-tree", "-r", "-z", "--name-only", hash, "--", "."],
			"Git couldn't read the checkpoint.",
		);

		const paths: string[] = [];

		for (const path of listing.split("\0")) if (isProjectFile(path) || path === CANVAS_FILE) paths.push(path);

		const contents = await Promise.all(
			paths.map((path) => must(dir, ["cat-file", "blob", `${hash}:./${path}`], `Git couldn't read ${path}.`)),
		);

		const files: ProjectFiles = {};
		let canvas: string | undefined;

		paths.forEach((path, index) => {
			if (path === CANVAS_FILE) canvas = contents[index];
			else files[path] = contents[index] ?? "";
		});

		return { files, canvas: versionCanvas(dir, canvas, files) };
	}

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

	return { status, init, setRemote, sync, checkpoint, checkpoints, readCheckpoint, run };
}

export type Git = ReturnType<typeof createGit>;
