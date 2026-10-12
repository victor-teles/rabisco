import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { AgentClientId } from "../../shared/mcp/clients";
import { tempDir } from "../test-utils";
import { bridgeLaunch, clientConfig, listClients, removeClient, setUpClient, type ClientEnv } from "./clients";

const LAUNCH = { command: "/Applications/Rabisco.app/Contents/Resources/app/bin/rabisco", args: ["mcp"] };

function setup(options: { which?: Record<string, string>; failRun?: boolean } = {}) {
	const home = tempDir();
	const runs: string[][] = [];

	const env: ClientEnv = {
		home,
		platform: "darwin",
		vars: {},
		which: (command) => options.which?.[command] ?? null,
		async run(argv) {
			runs.push(argv);

			return { ok: !options.failRun, output: options.failRun ? "boom" : "" };
		},
	};

	const file = (id: AgentClientId) => clientConfig(id, env).file;
	const read = (id: AgentClientId) => readFileSync(file(id), "utf-8");

	const write = (id: AgentClientId, text: string) => {
		mkdirSync(dirname(file(id)), { recursive: true });
		writeFileSync(file(id), text);
	};

	const status = (id: AgentClientId, connected: AgentClientId[] = []) =>
		listClients(env, LAUNCH, new Set(connected)).find((client) => client.id === id);

	return { home, env, runs, file, read, write, status };
}

describe("bridgeLaunch", () => {
	test("uses the bundled command when it is there, else npx", () => {
		const dir = tempDir();
		const bundled = join(dir, "rabisco");
		writeFileSync(bundled, "");

		expect(bridgeLaunch(bundled)).toEqual({ command: bundled, args: ["mcp"] });
		expect(bridgeLaunch(join(dir, "missing"))).toEqual({ command: "npx", args: ["-y", "rabisco-mcp"] });
		expect(bridgeLaunch(null).command).toBe("npx");
	});
});

describe("clientConfig", () => {
	test("finds each client's config file on macOS", () => {
		const { env, home } = setup();
		const support = join(home, "Library", "Application Support");

		expect(clientConfig("claude-code", env).file).toBe(join(home, ".claude.json"));
		expect(clientConfig("codex", env).file).toBe(join(home, ".codex", "config.toml"));
		expect(clientConfig("cursor", env).file).toBe(join(home, ".cursor", "mcp.json"));
		expect(clientConfig("vscode", env).file).toBe(join(support, "Code", "User", "mcp.json"));
		expect(clientConfig("claude-desktop", env).file).toBe(join(support, "Claude", "claude_desktop_config.json"));
	});

	test("follows CODEX_HOME, CLAUDE_CONFIG_DIR and the Linux config folder", () => {
		const { env } = setup();
		const linux = { ...env, platform: "linux" as const, vars: { CODEX_HOME: "/c", CLAUDE_CONFIG_DIR: "/cc" } };

		expect(clientConfig("codex", linux).file).toBe("/c/config.toml");
		expect(clientConfig("claude-code", linux).file).toBe("/cc/.claude.json");
		expect(clientConfig("vscode", linux).file).toBe(join(env.home, ".config", "Code", "User", "mcp.json"));
	});
});

describe("setUpClient", () => {
	test("adds the server to a JSON config and keeps everything else", async () => {
		const { env, read, write, status } = setup();
		write("cursor", '{\n\t"mcpServers": {\n\t\t"other": { "command": "x" }\n\t},\n\t"theme": "dark"\n}\n');

		expect(status("cursor")?.setup).toBe("none");
		await setUpClient("cursor", env, LAUNCH);

		expect(JSON.parse(read("cursor"))).toEqual({
			mcpServers: { other: { command: "x" }, rabisco: { command: LAUNCH.command, args: ["mcp"] } },
			theme: "dark",
		});
		expect(read("cursor")).toContain('\n\t"theme"');
		expect(status("cursor")?.setup).toBe("current");
	});

	test("creates a missing config, with VS Code's servers key and type", async () => {
		const { env, read, file } = setup();
		await setUpClient("vscode", env, LAUNCH);
		await setUpClient("claude-desktop", env, LAUNCH);

		expect(JSON.parse(read("vscode"))).toEqual({
			servers: { rabisco: { type: "stdio", command: LAUNCH.command, args: ["mcp"] } },
		});
		expect(JSON.parse(read("claude-desktop")).mcpServers.rabisco.command).toBe(LAUNCH.command);
		expect(statSync(file("vscode")).mode & 0o777).toBe(0o644);
	});

	test("keeps the file mode of an existing config", async () => {
		const { env, write, file } = setup();
		write("claude-desktop", "{}");
		const { chmodSync } = await import("fs");
		chmodSync(file("claude-desktop"), 0o600);
		await setUpClient("claude-desktop", env, LAUNCH);

		expect(statSync(file("claude-desktop")).mode & 0o777).toBe(0o600);
	});

	test("an entry that launches something else is outdated, and setup replaces it", async () => {
		const { env, write, status, read } = setup();
		write("cursor", JSON.stringify({ mcpServers: { rabisco: { command: "npx", args: ["-y", "rabisco-mcp"] } } }));

		expect(status("cursor")?.setup).toBe("outdated");
		await setUpClient("cursor", env, LAUNCH);
		expect(JSON.parse(read("cursor")).mcpServers.rabisco.command).toBe(LAUNCH.command);
	});

	test("leaves a config it can't parse alone", async () => {
		const { env, write, read } = setup();
		write("vscode", "{ // comment\n}");

		expect(setUpClient("vscode", env, LAUNCH)).rejects.toThrow("isn't plain JSON");
		expect(read("vscode")).toBe("{ // comment\n}");
	});

	test("writes Codex's TOML table and replaces an older one with its subtables", async () => {
		const { env, write, read, status } = setup();

		write(
			"codex",
			'model = "o3"\n\n[mcp_servers.rabisco]\ncommand = "old"\n\n[mcp_servers.rabisco.env]\nA = "1"\n\n[mcp_servers.other]\ncommand = "x"\n',
		);
		expect(status("codex")?.setup).toBe("outdated");
		await setUpClient("codex", env, LAUNCH);

		expect(read("codex")).toBe(
			`model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.rabisco]\ncommand = "${LAUNCH.command}"\nargs = ["mcp"]\n`,
		);
		expect(status("codex")?.setup).toBe("current");

		await removeClient("codex", env);
		expect(read("codex")).toBe('model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n');
	});

	test("uses the Claude Code CLI when it is installed", async () => {
		const { env, runs, file } = setup({ which: { claude: "/bin/claude" } });
		await setUpClient("claude-code", env, LAUNCH);

		expect(runs).toEqual([
			["/bin/claude", "mcp", "remove", "--scope", "user", "rabisco"],
			[
				"/bin/claude",
				"mcp",
				"add-json",
				"--scope",
				"user",
				"rabisco",
				JSON.stringify({ type: "stdio", command: LAUNCH.command, args: ["mcp"] }),
			],
		]);
		expect(() => statSync(file("claude-code"))).toThrow();
	});

	test("reports a failing Claude Code CLI", async () => {
		const { env } = setup({ which: { claude: "/bin/claude" }, failRun: true });

		expect(setUpClient("claude-code", env, LAUNCH)).rejects.toThrow("boom");
	});

	test("edits ~/.claude.json without the CLI, and removes the entry", async () => {
		const { env, write, read, status } = setup();
		write("claude-code", JSON.stringify({ numStartups: 3, mcpServers: {} }));
		await setUpClient("claude-code", env, LAUNCH);

		expect(JSON.parse(read("claude-code")).mcpServers.rabisco).toEqual({
			type: "stdio",
			command: LAUNCH.command,
			args: ["mcp"],
		});
		await removeClient("claude-code", env);
		expect(JSON.parse(read("claude-code"))).toEqual({ numStartups: 3, mcpServers: {} });
		expect(status("claude-code")?.setup).toBe("none");
	});

	test("removing from a client with no config writes nothing", async () => {
		const { env, file } = setup();
		await removeClient("cursor", env);
		await removeClient("codex", env);

		expect(() => statSync(file("cursor"))).toThrow();
		expect(() => statSync(file("codex"))).toThrow();
	});
});

describe("listClients", () => {
	test("says which clients are on this computer and which connected", () => {
		const { home, status } = setup({ which: { codex: "/bin/codex" } });
		mkdirSync(join(home, ".cursor"));

		expect(status("cursor", ["cursor"])).toEqual({
			id: "cursor",
			name: "Cursor",
			detected: true,
			setup: "none",
			connected: true,
		});
		expect(status("codex")?.detected).toBe(true);
		expect(status("claude-desktop")?.detected).toBe(false);
	});
});
