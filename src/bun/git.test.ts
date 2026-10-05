import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createGit, parsePorcelain } from "./git";
import { resolveBinary } from "./ai/cli";
import { tempDir } from "./test-utils";

const hasGit = resolveBinary("git") !== null && Bun.spawnSync(["git", "--version"]).exitCode === 0;

/** A fixed identity and no user or system config, so the tests behave the same everywhere. */
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

/** Runs git outside Rabisco, like a collaborator would. */
function sh(cwd: string, ...args: string[]) {
	const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...ENV } });

	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);

	return result.stdout.toString().trim();
}

function makeProject(parent = tempDir()) {
	const dir = join(parent, "app.rabisco");
	mkdirSync(join(dir, "screens"), { recursive: true });
	writeFileSync(join(dir, "rabisco.json"), "{}\n");
	writeFileSync(join(dir, "screens/welcome.tsx"), "export default function Welcome() {\n\treturn <h1>Hello</h1>;\n}\n");
	writeFileSync(join(dir, "DESIGN.md"), "# Design\n");

	return dir;
}

const git = createGit({ timeoutMs: 10_000, networkTimeoutMs: 10_000 });

describe("parsePorcelain", () => {
	test("reads statuses, untracked files and renames", () => {
		const output =
			" M screens/a.tsx\0?? screens/b.tsx\0D  DESIGN.md\0R  screens/new.tsx\0screens/old.tsx\0A  components/x.tsx\0";

		expect(parsePorcelain(output)).toEqual([
			{ status: "M", path: "screens/a.tsx" },
			{ status: "?", path: "screens/b.tsx" },
			{ status: "D", path: "DESIGN.md" },
			{ status: "R", path: "screens/new.tsx" },
			{ status: "A", path: "components/x.tsx" },
		]);
	});
});

describe("without git", () => {
	test("status says git is missing, and how to get it", async () => {
		const status = await createGit({ bin: null }).status(tempDir());
		expect(status.state).toBe("unavailable");

		if (status.state === "unavailable") expect(status.error).toContain("Install it");
		expect(await createGit({ bin: null }).sync(tempDir())).toMatchObject({ ok: false });
	});
});

describe.skipIf(!hasGit)("git sync", () => {
	test("set up: init, .gitignore and a first commit", async () => {
		const dir = makeProject();
		expect((await git.status(dir)).state).toBe("none");
		const status = await git.init(dir, "My app");
		expect(status).toMatchObject({
			state: "repo",
			branch: "main",
			hasCommits: true,
			changes: 0,
			remote: null,
			prefix: "",
		});

		if (status.state === "repo") expect(status.lastCommit?.subject).toBe("Rabisco: start My app");
		expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain(".DS_Store");
		await expect(git.init(dir, "again")).rejects.toThrow("already in a git repository");
	});

	test("sync without a remote commits with a generated message", async () => {
		const dir = makeProject();
		await git.init(dir, "app");
		writeFileSync(join(dir, "screens/welcome.tsx"), "export default function Welcome() {\n\treturn <h1>Hi</h1>;\n}\n");
		writeFileSync(join(dir, "screens/settings.tsx"), "export default () => null;\n");
		expect(await git.status(dir)).toMatchObject({ changes: 2 });
		const result = await git.sync(dir);
		expect(result).toMatchObject({ ok: true, remote: null, pulled: 0, pushed: 0 });

		if (result.ok) expect(result.committed?.subject).toBe("Rabisco: add settings screen, update welcome screen");
		expect(sh(dir, "log", "-1", "--format=%b")).toContain("- add screens/settings.tsx");
		expect(await git.sync(dir)).toMatchObject({ ok: true, committed: null });
	});

	test("sync with a remote: first push sets the upstream, then pulls and pushes", async () => {
		const bare = join(tempDir(), "remote.git");
		sh(tempDir(), "init", "-q", "--bare", "-b", "main", bare);
		const dir = makeProject();
		await git.init(dir, "app");
		await expect(git.setRemote(dir, "--upload-pack=evil")).rejects.toThrow("Enter a repository URL");
		const withRemote = await git.setRemote(dir, bare);
		expect(withRemote).toMatchObject({ remote: { name: "origin", url: bare }, upstream: null });

		const first = await git.sync(dir);
		expect(first).toMatchObject({ ok: true, pushed: 1, pulled: 0, remote: "origin" });
		expect(await git.status(dir)).toMatchObject({ upstream: "origin/main", ahead: 0, behind: 0 });

		// A collaborator pushes a change
		const other = join(tempDir(), "clone");
		sh(tempDir(), "clone", "-q", bare, other);
		writeFileSync(join(other, "DESIGN.md"), "# Design\n\n- primary: red\n");
		sh(other, "commit", "-qam", "Change the design");
		sh(other, "push", "-q");

		// A local change, not synced yet: one ahead
		writeFileSync(join(dir, "screens/about.tsx"), "export default () => null;\n");
		sh(dir, "add", ".");
		sh(dir, "commit", "-qm", "Add about");
		sh(dir, "fetch", "-q");
		expect(await git.status(dir)).toMatchObject({ ahead: 1, behind: 1 });

		const second = await git.sync(dir);
		expect(second).toMatchObject({ ok: true, pulled: 1, pushed: 1 });
		expect(readFileSync(join(dir, "DESIGN.md"), "utf8")).toContain("primary: red");
		sh(other, "pull", "-q");
		expect(existsSync(join(other, "screens/about.tsx"))).toBe(true);
		expect(await git.status(dir)).toMatchObject({ ahead: 0, behind: 0, changes: 0 });
	});

	test("a conflict aborts the rebase and leaves the repository clean", async () => {
		const bare = join(tempDir(), "remote.git");
		sh(tempDir(), "init", "-q", "--bare", "-b", "main", bare);
		const dir = makeProject();
		await git.init(dir, "app");
		await git.setRemote(dir, bare);
		await git.sync(dir);

		const other = join(tempDir(), "clone");
		sh(tempDir(), "clone", "-q", bare, other);
		writeFileSync(
			join(other, "screens/welcome.tsx"),
			"export default function Welcome() {\n\treturn <h1>Theirs</h1>;\n}\n",
		);
		sh(other, "commit", "-qam", "Theirs");
		sh(other, "push", "-q");

		const mine = "export default function Welcome() {\n\treturn <h1>Mine</h1>;\n}\n";
		writeFileSync(join(dir, "screens/welcome.tsx"), mine);
		const result = await git.sync(dir);
		expect(result.ok).toBe(false);

		if (!result.ok) {
			expect(result.error).toContain("edit the same lines");
			expect(result.error).toContain("committed locally");
			expect(result.detail).toBeTruthy();
		}

		expect(await git.status(dir)).toMatchObject({ unfinished: null, changes: 0, ahead: 1, behind: 1 });
		expect(readFileSync(join(dir, "screens/welcome.tsx"), "utf8")).toBe(mine);
	});

	test("an unreachable remote fails without hanging", async () => {
		const dir = makeProject();
		await git.init(dir, "app");
		await git.setRemote(dir, join(tempDir(), "missing.git"));
		const result = await git.sync(dir);
		expect(result.ok).toBe(false);

		if (!result.ok) expect(result.error).toContain("origin");
	});

	test("a project inside a bigger repository only commits its own folder", async () => {
		const root = tempDir();
		sh(root, "init", "-q");
		writeFileSync(join(root, "README.md"), "readme\n");
		sh(root, "add", "README.md");
		sh(root, "commit", "-qm", "Initial");
		const dir = makeProject(join(root, "design"));
		writeFileSync(join(root, "README.md"), "changed\n");
		sh(root, "add", "README.md");

		const status = await git.status(dir);
		expect(status).toMatchObject({ state: "repo", prefix: "design/app.rabisco/", changes: 3 });
		await expect(git.init(dir, "app")).rejects.toThrow("already in a git repository");

		const result = await git.sync(dir);
		expect(result).toMatchObject({ ok: true, remote: null });
		expect(sh(root, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual([
			"design/app.rabisco/DESIGN.md",
			"design/app.rabisco/rabisco.json",
			"design/app.rabisco/screens/welcome.tsx",
		]);
		// The README change is still staged, not committed
		expect(sh(root, "diff", "--cached", "--name-only")).toBe("README.md");
	});
});
