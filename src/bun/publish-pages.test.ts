import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveBinary } from "./ai/cli";
import { createGit } from "./git";
import type { PublishFile } from "./publish-hosts";
import { createPages, noticeFiles, PAGES_MARKER } from "./publish-pages";
import { tempDir } from "./test-utils";

const hasGit = resolveBinary("git") !== null && Bun.spawnSync(["git", "--version"]).exitCode === 0;

const ENV = {
	GIT_AUTHOR_NAME: "Test",
	GIT_AUTHOR_EMAIL: "test@example.com",
	GIT_COMMITTER_NAME: "Test",
	GIT_COMMITTER_EMAIL: "test@example.com",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
};

const saved: Record<string, string | undefined> = {};

beforeAll(() => {
	for (const [key, value] of Object.entries(ENV)) {
		saved[key] = process.env[key];
		process.env[key] = value;
	}
});

afterAll(() => {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

function sh(cwd: string, ...args: string[]) {
	const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...ENV } });

	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);

	return result.stdout.toString().trim();
}

const GITHUB_URL = "https://github.com/acme/shop.git";

const encoder = new TextEncoder();

const site = (text: string): PublishFile[] => [
	{ path: "index.html", body: encoder.encode(`<p>${text}</p>`) },
	{ path: "runtime/frame.html", body: encoder.encode("<script></script>") },
];

/** A repository with two project folders, its remote on "GitHub" and a bare repository behind it */
function setup() {
	const parent = tempDir();
	const bare = join(parent, "remote.git");
	const root = join(parent, "repo");
	const project = join(root, "app.rabisco");
	const other = join(root, "other.rabisco");

	sh(parent, "init", "-q", "--bare", bare);

	for (const dir of [project, other]) {
		mkdirSync(join(dir, "screens"), { recursive: true });
		writeFileSync(join(dir, "screens/home.tsx"), "export default () => <p>Home</p>;\n");
	}

	sh(parent, "init", "-q", root);
	sh(root, "symbolic-ref", "HEAD", "refs/heads/main");
	sh(root, "add", "-A");
	sh(root, "commit", "-q", "-m", "start");
	sh(root, "remote", "add", "origin", GITHUB_URL);
	sh(root, "config", `url.${bare}.insteadOf`, GITHUB_URL);
	sh(root, "push", "-q", "-u", "origin", "main");

	return { parent, bare, root, project, other };
}

const SLOW = 30_000;

const git = createGit({ timeoutMs: 10_000, networkTimeoutMs: 10_000 });

const pages = createPages(git);

const listing = (bare: string, branch: string) => sh(bare, "ls-tree", "-r", "--name-only", branch).split("\n");

describe.skipIf(!hasGit)("GitHub Pages through git sync", () => {
	test(
		"says what to set up before it can publish",
		async () => {
			const folder = tempDir();
			expect(await pages.status(folder)).toEqual({ state: "setup", step: "repo" });

			sh(folder, "init", "-q");
			expect(await pages.status(folder)).toEqual({ state: "setup", step: "remote" });

			sh(folder, "remote", "add", "origin", "https://user:secret@gitlab.com/acme/shop.git");

			expect(await pages.status(folder)).toEqual({
				state: "setup",
				step: "github",
				remoteUrl: "https://gitlab.com/acme/shop.git",
			});

			expect(await createPages(createGit({ bin: null })).status(folder)).toMatchObject({ state: "unavailable" });
		},
		SLOW,
	);

	test(
		"finds the Pages URL of the project's GitHub remote",
		async () => {
			const { project } = setup();

			expect(await pages.status(project)).toEqual({
				state: "ready",
				remote: "origin",
				repo: "acme/shop",
				url: "https://acme.github.io/shop/",
				settingsUrl: "https://github.com/acme/shop/settings/pages",
			});
		},
		SLOW,
	);

	test(
		"pushes the site to its own branch, commits on top of it and leaves the project alone",
		async () => {
			const { parent, bare, root, project } = setup();
			const head = sh(root, "rev-parse", "HEAD");

			writeFileSync(join(project, "screens/draft.tsx"), "export default () => null;\n");

			const deployed = await pages.deploy({ dir: project, branch: "gh-pages", files: site("one"), message: "first" });
			expect(deployed).toEqual({ siteId: "gh-pages", siteName: "acme/shop", url: "https://acme.github.io/shop/" });
			expect(listing(bare, "gh-pages").sort()).toEqual([".nojekyll", PAGES_MARKER, "index.html", "runtime/frame.html"]);
			expect(sh(bare, "show", "gh-pages:index.html")).toBe("<p>one</p>");
			expect(JSON.parse(sh(bare, "show", `gh-pages:${PAGES_MARKER}`))).toEqual({ project: "app.rabisco/" });

			expect(sh(root, "rev-parse", "HEAD")).toBe(head);
			expect(sh(root, "branch", "--list")).toBe("* main");
			expect(sh(root, "status", "--porcelain")).toBe("?? app.rabisco/screens/draft.tsx");

			const first = sh(bare, "rev-parse", "gh-pages");
			await pages.deploy({ dir: project, branch: "gh-pages", files: site("two"), message: "second" });
			expect(sh(bare, "rev-parse", "gh-pages^")).toBe(first);
			expect(sh(bare, "show", "gh-pages:index.html")).toBe("<p>two</p>");

			const second = sh(bare, "rev-parse", "gh-pages");
			await pages.deploy({ dir: project, branch: "gh-pages", files: site("two"), message: "same" });
			expect(sh(bare, "rev-parse", "gh-pages")).toBe(second);

			const clone = join(parent, "clone");
			sh(parent, "clone", "-q", "-b", "gh-pages", bare, clone);
			writeFileSync(join(clone, "CNAME"), "design.acme.com\n");
			sh(clone, "add", "CNAME");
			sh(clone, "commit", "-q", "-m", "Custom domain");
			sh(clone, "push", "-q", "origin", "gh-pages");

			await pages.deploy({
				dir: project,
				branch: "gh-pages",
				files: noticeFiles("Removed", "Gone."),
				message: "remove",
			});
			expect(listing(bare, "gh-pages").sort()).toEqual([".nojekyll", PAGES_MARKER, "CNAME", "index.html"]);
			expect(sh(bare, "show", "gh-pages:CNAME")).toBe("design.acme.com");
			expect(sh(bare, "show", "gh-pages:index.html")).toContain("<h1>Removed</h1>");
			expect(sh(bare, "rev-list", "--count", "gh-pages")).toBe("4");
		},
		SLOW,
	);

	test(
		"refuses a branch with files Rabisco didn't publish, another project's site or the project's branch",
		async () => {
			const { parent, bare, project, other } = setup();
			const clone = join(parent, "clone");

			sh(parent, "clone", "-q", bare, clone);
			sh(clone, "checkout", "-q", "--orphan", "docs");
			sh(clone, "commit", "-q", "--allow-empty", "-m", "docs");
			sh(clone, "push", "-q", "origin", "docs");

			await expect(pages.deploy({ dir: project, branch: "docs", files: site("x"), message: "x" })).rejects.toThrow(
				"has files Rabisco didn't publish",
			);
			expect(sh(bare, "rev-list", "--count", "docs")).toBe("1");

			await pages.deploy({ dir: project, branch: "gh-pages", files: site("x"), message: "x" });

			await expect(pages.deploy({ dir: other, branch: "gh-pages", files: site("y"), message: "y" })).rejects.toThrow(
				"another project's site",
			);

			await expect(pages.deploy({ dir: project, branch: "main", files: site("x"), message: "x" })).rejects.toThrow(
				"The project itself is on main",
			);

			await expect(pages.deploy({ dir: project, branch: "no..pe", files: site("x"), message: "x" })).rejects.toThrow(
				"isn't a branch name",
			);
		},
		SLOW,
	);

	test(
		"says to publish again when the branch moved during the push",
		async () => {
			const { bare, project } = setup();
			await pages.deploy({ dir: project, branch: "gh-pages", files: site("one"), message: "one" });

			const hook = join(bare, "hooks", "pre-receive");
			writeFileSync(hook, "#!/bin/sh\necho ' ! [rejected] (fetch first)' >&2\nexit 1\n", { mode: 0o755 });

			await expect(
				pages.deploy({ dir: project, branch: "gh-pages", files: site("two"), message: "two" }),
			).rejects.toThrow("changed on origin while Rabisco published");
		},
		SLOW,
	);
});
