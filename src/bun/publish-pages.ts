// Decision 0043: GitHub Pages through the project's git sync remote, with the system git and no token
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { redactRemoteUrl } from "../shared/git";
import { isString } from "../shared/guards";
import {
	DEFAULT_PAGES_BRANCH,
	githubRepo,
	pagesSettingsUrl,
	pagesUrl,
	type GithubRepo,
	type PagesStatus,
} from "../shared/share/publish";
import { commitFailure, GitError, output, remoteFailure, type Git, type GitResult } from "./git";
import { objectOr, parseJson } from "./json";
import type { DeployedSite, PublishFile } from "./publish-hosts";

export const PAGES_MARKER = ".rabisco-publish";

const CNAME = "CNAME";

export type PagesDeployRequest = { dir: string; branch: string; files: PublishFile[]; message: string };

export type PagesClient = {
	status(dir: string): Promise<PagesStatus>;
	deploy(request: PagesDeployRequest): Promise<DeployedSite>;
};

type Ready = { remote: string; repo: GithubRepo; prefix: string; branch: string | null; upstream: string | null };

const encoder = new TextEncoder();

function markerProject(text: string) {
	try {
		const project = objectOr(parseJson(text)).project;

		return isString(project) ? project : null;
	} catch {
		return null;
	}
}

function pushFailure(remote: string, branch: string, result: GitResult) {
	if (/rejected|non-fast-forward|fetch first/i.test(output(result)))
		return new GitError(
			`The ${branch} branch changed on ${remote} while Rabisco published. Publish again.`,
			output(result),
		);

	return remoteFailure("push to", remote, result);
}

export function createPages(git: Git): PagesClient {
	async function inspect(dir: string): Promise<{ status: PagesStatus; ready?: Ready }> {
		const current = await git.status(dir);

		if (current.state === "unavailable") return { status: { state: "unavailable", error: current.error } };

		if (current.state === "none") return { status: { state: "setup", step: "repo" } };

		if (!current.remote) return { status: { state: "setup", step: "remote" } };
		// As typed, before `insteadOf` rewrites it
		const configured = await git.run(dir, ["config", "--get", `remote.${current.remote.name}.url`]);
		const remoteUrl = configured.code === 0 ? redactRemoteUrl(configured.stdout.trim()) : current.remote.url;
		const repo = githubRepo(remoteUrl);

		if (!repo) return { status: { state: "setup", step: "github", remoteUrl } };

		return {
			status: {
				state: "ready",
				remote: current.remote.name,
				repo: `${repo.owner}/${repo.name}`,
				url: pagesUrl(repo),
				settingsUrl: pagesSettingsUrl(repo),
			},
			ready: {
				remote: current.remote.name,
				repo,
				prefix: current.prefix,
				branch: current.branch,
				upstream: current.upstream,
			},
		};
	}

	async function must(cwd: string, args: string[], message: string, env?: Record<string, string>) {
		const result = await git.run(cwd, args, undefined, env);

		if (result.code !== 0) throw new GitError(message, output(result));

		return result.stdout.trim();
	}

	async function checkBranch(dir: string, branch: string, ready: Ready) {
		const valid = !branch.startsWith("-") && (await git.run(dir, ["check-ref-format", "--branch", branch])).code === 0;

		if (!valid) throw new GitError(`"${branch}" isn't a branch name git accepts. Try ${DEFAULT_PAGES_BRANCH}.`);

		const upstream = ready.upstream?.startsWith(`${ready.remote}/`)
			? ready.upstream.slice(ready.remote.length + 1)
			: null;

		if (branch === ready.branch || branch === upstream)
			throw new GitError(
				`The project itself is on ${branch}. Publish the site to a branch of its own, like ${DEFAULT_PAGES_BRANCH}.`,
			);
	}

	/** The branch's last commit, after checking Rabisco made it for this project */
	async function parentCommit(dir: string, branch: string, ready: Ready) {
		const { remote } = ready;
		const ref = `refs/heads/${branch}`;
		const listed = await git.run(dir, ["ls-remote", "--heads", remote, ref], git.networkTimeoutMs);

		if (listed.code !== 0) throw remoteFailure("pull from", remote, listed);
		const hash = listed.stdout.split(/\s+/)[0];

		if (!hash) return null;
		const fetched = await git.run(dir, ["fetch", "-q", "--no-tags", remote, ref], git.networkTimeoutMs);

		if (fetched.code !== 0) throw remoteFailure("pull from", remote, fetched);
		const marker = await git.run(dir, ["cat-file", "blob", `${hash}:${PAGES_MARKER}`]);

		if (marker.code !== 0)
			throw new GitError(
				`The ${branch} branch on ${remote} has files Rabisco didn't publish, so Rabisco left it alone. Pick another branch.`,
			);

		if (markerProject(marker.stdout) !== ready.prefix)
			throw new GitError(`The ${branch} branch on ${remote} has another project's site. Pick another branch.`);

		return hash;
	}

	async function writeTree(dir: string, files: PublishFile[]) {
		const gitDir = await must(dir, ["rev-parse", "--absolute-git-dir"], "Git couldn't find the repository.");
		const scratch = mkdtempSync(join(tmpdir(), "rabisco-pages-"));
		const site = join(scratch, "site");

		try {
			for (const file of files) {
				const path = join(site, file.path);
				mkdirSync(dirname(path), { recursive: true });
				writeFileSync(path, file.body);
			}

			// A scratch index, so the project's own index and working tree stay as they are
			const env = { GIT_INDEX_FILE: join(scratch, "index") };
			const scoped = [`--git-dir=${gitDir}`, `--work-tree=${site}`];
			await must(site, [...scoped, "add", "-A", "-f", "--", "."], "Git couldn't stage the site's files.", env);

			return await must(site, [...scoped, "write-tree"], "Git couldn't write the site's files.", env);
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	}

	return {
		async status(dir) {
			return (await inspect(dir)).status;
		},

		async deploy({ dir, branch, files, message }) {
			const { status, ready } = await inspect(dir);

			if (!ready || status.state !== "ready")
				throw new GitError(
					status.state === "unavailable" ? status.error : "Set up git sync with a GitHub remote first.",
				);
			await checkBranch(dir, branch, ready);
			const parent = await parentCommit(dir, branch, ready);

			const all = [
				...files,
				{ path: PAGES_MARKER, body: encoder.encode(`${JSON.stringify({ project: ready.prefix })}\n`) },
				// Pages would otherwise run Jekyll, which skips some files
				{ path: ".nojekyll", body: new Uint8Array() },
			];

			// GitHub keeps a custom domain in this file on the branch
			const domain = parent ? await git.run(dir, ["cat-file", "blob", `${parent}:${CNAME}`]) : null;

			if (domain?.code === 0) all.push({ path: CNAME, body: encoder.encode(domain.stdout) });
			const tree = await writeTree(dir, all);

			const site = { siteId: branch, siteName: status.repo, url: status.url };

			if (parent && (await must(dir, ["rev-parse", `${parent}^{tree}`], "Git couldn't read the branch.")) === tree)
				return site;
			const committed = await git.run(dir, ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message]);

			if (committed.code !== 0) throw commitFailure(output(committed), "publish again");

			const pushed = await git.run(
				dir,
				["push", "-q", ready.remote, `${committed.stdout.trim()}:refs/heads/${branch}`],
				git.networkTimeoutMs,
			);

			if (pushed.code !== 0) throw pushFailure(ready.remote, branch, pushed);

			return site;
		},
	};
}

/** Replaces the site when it's removed or expires: Rabisco never deletes the branch or rewrites its history */
export function noticeFiles(title: string, text: string): PublishFile[] {
	const html = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="robots" content="noindex" />
		<title>${title}</title>
		<style>
			body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 15px/1.5 system-ui, sans-serif; color: #444; background: #fafafa; }
			main { max-width: 22rem; padding: 2rem; text-align: center; }
			h1 { margin: 0 0 0.5rem; font-size: 17px; font-weight: 600; color: #111; }
			p { margin: 0; }
		</style>
	</head>
	<body>
		<main>
			<h1>${title}</h1>
			<p>${text}</p>
		</main>
	</body>
</html>
`;

	return [{ path: "index.html", body: encoder.encode(html) }];
}
