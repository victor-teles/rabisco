import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import type { AgentCall } from "../../shared/mcp/tools";
import { textResult } from "../../shared/mcp/tools";
import { tempDir } from "../test-utils";
import { AGENTS_FILE, createAgentService, DISCOVERY_FILE } from "./agents";
import type { CallTool, SeenClient } from "./server";

type FakeServer = { port: number; token: string; stopped: boolean; call: CallTool; seen?: SeenClient };

function setup(options: { timeoutMs?: number; send?: (call: AgentCall) => void } = {}) {
	const dir = tempDir();
	const sent: AgentCall[] = [];
	const servers: FakeServer[] = [];

	const agents = createAgentService({
		userDataDir: dir,
		appVersion: "1.0.0",
		send: options.send ?? ((call) => sent.push(call)),
		timeoutMs: options.timeoutMs,
		start: (_version, call, seen) => {
			const server: FakeServer = {
				port: 5000 + servers.length,
				token: `token-${servers.length}`,
				stopped: false,
				call,
				seen,
			};

			servers.push(server);

			return {
				port: server.port,
				token: server.token,
				stop: () => {
					server.stopped = true;
				},
			};
		},
	});

	const discovery = () => JSON.parse(readFileSync(join(dir, DISCOVERY_FILE), "utf-8"));

	return { dir, agents, sent, servers, discovery };
}

describe("createAgentService", () => {
	test("is off by default and writes a discovery file that says so", () => {
		const { agents, servers, discovery, dir } = setup();

		expect(agents.init()).toEqual({ enabled: false, port: null });
		expect(servers).toEqual([]);
		expect(discovery()).toEqual({ version: 1, enabled: false, pid: process.pid, appVersion: "1.0.0" });
		expect(statSync(join(dir, DISCOVERY_FILE)).mode & 0o777).toBe(0o600);
	});

	test("turning it on starts a server and remembers the setting", () => {
		const { agents, servers, discovery, dir } = setup();
		agents.init();

		expect(agents.setEnabled(true)).toEqual({ enabled: true, port: 5000 });
		expect(discovery()).toEqual({
			version: 1,
			enabled: true,
			port: 5000,
			token: "token-0",
			pid: process.pid,
			appVersion: "1.0.0",
		});
		expect(JSON.parse(readFileSync(join(dir, AGENTS_FILE), "utf-8"))).toEqual({ enabled: true });

		const again = createAgentService({
			userDataDir: dir,
			appVersion: "1.0.0",
			send: () => {},
			start: () => ({ port: 6000, token: "next", stop: () => {} }),
		});

		expect(again.init()).toEqual({ enabled: true, port: 6000 });
		expect(servers[0]!.stopped).toBe(false);
	});

	test("turning it off stops the server and drops the token from the file", () => {
		const { agents, servers, discovery } = setup();
		agents.setEnabled(true);

		expect(agents.setEnabled(false)).toEqual({ enabled: false, port: null });
		expect(servers[0]!.stopped).toBe(true);
		expect(discovery()).not.toHaveProperty("token");
	});

	test("a server that can't start leaves the setting off", () => {
		const dir = tempDir();

		const agents = createAgentService({
			userDataDir: dir,
			appVersion: "1.0.0",
			send: () => {},
			start: () => {
				throw new Error("port in use");
			},
		});

		agents.init();

		expect(() => agents.setEnabled(true)).toThrow("port in use");
		expect(agents.status()).toEqual({ enabled: false, port: null });
		expect(existsSync(join(dir, AGENTS_FILE))).toBe(false);
	});

	test("a server that can't start at launch shows as on with no port", () => {
		const dir = tempDir();
		writeFileSync(join(dir, AGENTS_FILE), JSON.stringify({ enabled: true }));

		const agents = createAgentService({
			userDataDir: dir,
			appVersion: "1.0.0",
			send: () => {},
			start: () => {
				throw new Error("port in use");
			},
		});

		expect(agents.init()).toEqual({ enabled: true, port: null });
		expect(JSON.parse(readFileSync(join(dir, DISCOVERY_FILE), "utf-8")).enabled).toBe(false);
	});

	test("reset access starts a new server with a new token", () => {
		const { agents, servers, discovery } = setup();
		agents.setEnabled(true);

		expect(agents.resetAccess()).toEqual({ enabled: true, port: 5001 });
		expect(servers[0]!.stopped).toBe(true);
		expect(discovery().token).toBe("token-1");
	});

	test("a call goes to the webview and resolves with its answer", async () => {
		const { agents, sent, servers } = setup();
		agents.setEnabled(true);
		const result = servers[0]!.call("get_project", { a: 1 }, "claude-code");

		expect(sent).toEqual([{ callId: expect.any(String), tool: "get_project", args: { a: 1 }, client: "claude-code" }]);
		agents.resolve("someone-else", textResult("no"));
		agents.resolve(sent[0]!.callId, textResult("yes"));
		expect(await result).toEqual(textResult("yes"));
	});

	test("a call the webview doesn't answer in time is an error", async () => {
		const { agents, servers } = setup({ timeoutMs: 10 });
		agents.setEnabled(true);

		expect(await servers[0]!.call("get_project", {}, "x")).toEqual({
			content: [{ type: "text", text: "Rabisco didn't answer in time. Try again." }],
			isError: true,
		});
	});

	test("a call that can't reach the webview is an error", async () => {
		const { agents, servers } = setup({
			send: () => {
				throw new Error("no webview");
			},
		});

		agents.setEnabled(true);
		const result = await servers[0]!.call("get_project", {}, "x");

		expect(result.isError).toBe(true);
	});

	test("stopping answers pending calls, and close removes the discovery file", async () => {
		const { agents, servers, dir } = setup();
		agents.setEnabled(true);
		const result = servers[0]!.call("get_project", {}, "x");
		agents.close();

		expect((await result).isError).toBe(true);
		expect(existsSync(join(dir, DISCOVERY_FILE))).toBe(false);
	});

	test("RABISCO_MCP_FILE moves the discovery file", () => {
		const dir = tempDir();
		const file = join(dir, "elsewhere.json");
		const before = process.env.RABISCO_MCP_FILE;
		process.env.RABISCO_MCP_FILE = file;

		try {
			createAgentService({ userDataDir: dir, appVersion: "1", send: () => {} }).init();
			expect(existsSync(file)).toBe(true);
			expect(existsSync(join(dir, DISCOVERY_FILE))).toBe(false);
		} finally {
			if (before === undefined) delete process.env.RABISCO_MCP_FILE;
			else process.env.RABISCO_MCP_FILE = before;
		}
	});

	test("a broken settings file counts as off", () => {
		const dir = tempDir();
		writeFileSync(join(dir, AGENTS_FILE), "{ nope");

		expect(createAgentService({ userDataDir: dir, appVersion: "1", send: () => {} }).init().enabled).toBe(false);
	});

	test("remembers which clients connected until the server stops", () => {
		const { agents, servers } = setup();
		agents.init();
		agents.setEnabled(true);
		servers[0]!.seen?.("claude-code");
		servers[0]!.seen?.("Visual Studio Code");
		servers[0]!.seen?.("agent");

		expect([...agents.connected()].sort()).toEqual(["claude-code", "vscode"]);
		agents.resetAccess();
		expect([...agents.connected()]).toEqual([]);
	});
});
