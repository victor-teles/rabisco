import { describe, expect, test } from "bun:test";
import { isString } from "../../shared/guards";
import type { Json, JsonObject } from "../../shared/json";
import { TOOLS, textResult } from "../../shared/mcp/tools";
import { createMcpHandler, newToken, sameToken, startMcpServer, type CallTool } from "./server";

const PORT = 4567;

const TOKEN = "a".repeat(64);

type Seen = { tool: string; args: JsonObject; client: string };

function setup(call?: CallTool) {
	const seen: Seen[] = [];
	const clients: string[] = [];

	const handle = createMcpHandler({
		port: PORT,
		token: TOKEN,
		version: "1.2.3",
		call:
			call ??
			(async (tool, args, client) => {
				seen.push({ tool, args, client });

				return textResult(`ran ${tool}`);
			}),
		seen: (client) => clients.push(client),
	});

	return { handle, seen, clients };
}

const post = (body: Json, headers: Record<string, string> = {}) =>
	new Request(`http://127.0.0.1:${PORT}/mcp`, {
		method: "POST",
		headers: {
			Host: `127.0.0.1:${PORT}`,
			Authorization: `Bearer ${TOKEN}`,
			"Content-Type": "application/json",
			...headers,
		},
		body: isString(body) ? body : JSON.stringify(body),
	});

const rpc = (method: string, params?: Json, id: number | null = 1) => ({ jsonrpc: "2.0", id, method, params });

describe("createMcpHandler", () => {
	test("refuses other hosts, web pages and missing or wrong tokens", async () => {
		const { handle, seen } = setup();
		const list = rpc("tools/list");

		expect((await handle(post(list, { Host: "evil.example:4567" }))).status).toBe(403);
		expect((await handle(post(list, { Host: "127.0.0.1:9999" }))).status).toBe(403);
		expect((await handle(post(list, { Origin: "https://example.com" }))).status).toBe(403);
		expect((await handle(post(list, { Authorization: "" }))).status).toBe(401);
		expect((await handle(post(list, { Authorization: `Bearer ${"b".repeat(64)}` }))).status).toBe(401);
		expect((await handle(post(list, { Authorization: "Bearer short" }))).status).toBe(401);
		expect((await handle(post(list, { Host: `localhost:${PORT}` }))).status).toBe(200);
		expect(seen).toEqual([]);
	});

	test("tells who called on every accepted request", async () => {
		const { handle, clients } = setup();
		await handle(post(rpc("tools/list"), { Origin: "https://example.com" }));
		await handle(post(rpc("tools/list"), { "Rabisco-Client": "claude-code" }));
		await handle(post(rpc("initialize", { clientInfo: { name: "cursor-vscode" } })));

		expect(clients).toEqual(["claude-code", "cursor-vscode"]);
	});

	test("serves POST /mcp only, with a JSON body", async () => {
		const { handle } = setup();
		const headers = { Host: `127.0.0.1:${PORT}`, Authorization: `Bearer ${TOKEN}` };

		expect((await handle(new Request(`http://127.0.0.1:${PORT}/other`, { method: "POST", headers }))).status).toBe(404);
		expect((await handle(new Request(`http://127.0.0.1:${PORT}/mcp`, { headers }))).status).toBe(405);
		expect((await handle(post(rpc("ping"), { "Content-Type": "text/plain" }))).status).toBe(415);
		expect((await handle(post("x".repeat(1024 * 1024 + 1)))).status).toBe(413);
	});

	test("answers initialize with the asked protocol version when it knows it", async () => {
		const { handle } = setup();
		const params = { protocolVersion: "2025-03-26", clientInfo: { name: "claude-code", version: "2" } };
		const reply = await (await handle(post(rpc("initialize", params)))).json();

		expect(reply).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: {
				protocolVersion: "2025-03-26",
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: "rabisco", title: "Rabisco", version: "1.2.3" },
			},
		});

		const unknown = await (await handle(post(rpc("initialize", { protocolVersion: "1999-01-01" })))).json();
		expect(unknown.result.protocolVersion).toBe("2025-06-18");
	});

	test("accepts notifications with 202 and no body", async () => {
		const { handle } = setup();
		const response = await handle(post({ jsonrpc: "2.0", method: "notifications/initialized" }));

		expect(response.status).toBe(202);
		expect(await response.text()).toBe("");
	});

	test("lists every tool with a title and hints", async () => {
		const { handle } = setup();
		const reply = await (await handle(post(rpc("tools/list")))).json();

		expect(reply.result.tools).toEqual(JSON.parse(JSON.stringify(TOOLS)));

		for (const tool of reply.result.tools) {
			expect(tool.title).toBeTruthy();
			expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
		}
	});

	test("forwards tools/call with the client from the header, never from another request", async () => {
		const { handle, seen } = setup();
		await handle(post(rpc("initialize", { clientInfo: { name: "claude-code" } })));

		const reply = await (
			await handle(post(rpc("tools/call", { name: "get_screen", arguments: { screen: "home" } }, 7)))
		).json();

		expect(reply).toEqual({ jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "ran get_screen" }] } });
		await handle(post(rpc("tools/call", { name: "get_project" }), { "Rabisco-Client": "cursor" }));
		expect(seen).toEqual([
			{ tool: "get_screen", args: { screen: "home" }, client: "agent" },
			{ tool: "get_project", args: {}, client: "cursor" },
		]);
	});

	test("returns protocol errors for unknown methods, tools and bad messages", async () => {
		const { handle, seen } = setup();
		const error = async (body: Json) => (await (await handle(post(body))).json()).error.code;

		expect(await error(rpc("resources/list"))).toBe(-32601);
		expect(await error(rpc("tools/call", { name: "delete_everything" }))).toBe(-32602);
		expect(await error(rpc("tools/call", { name: "get_project", arguments: [1] }))).toBe(-32602);
		expect(await error(rpc("ping", [1]))).toBe(-32602);
		expect(await error({ id: 1, method: "ping" })).toBe(-32600);
		expect(await error([rpc("ping")])).toBe(-32600);
		expect(await error("{ nope")).toBe(-32700);
		expect(seen).toEqual([]);
	});

	test("turns a failing call into an error result", async () => {
		const { handle } = setup(async () => {
			throw new Error("boom");
		});

		const reply = await (await handle(post(rpc("tools/call", { name: "get_project" })))).json();

		expect(reply.result).toEqual({ content: [{ type: "text", text: "boom" }], isError: true });
	});
});

describe("tokens", () => {
	test("are 256 bits and new each time", () => {
		const token = newToken();

		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(newToken()).not.toBe(token);
		expect(sameToken(token, token)).toBe(true);
		expect(sameToken(`${token}0`, token)).toBe(false);
	});
});

describe("startMcpServer", () => {
	test("listens on loopback with a new token and stops", async () => {
		const server = startMcpServer("1.0.0", async (tool) => textResult(tool));

		try {
			expect(server.port).toBeGreaterThan(0);

			const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
				method: "POST",
				headers: { Authorization: `Bearer ${server.token}`, "Content-Type": "application/json" },
				body: JSON.stringify(rpc("tools/call", { name: "get_selection" })),
			});

			expect(await response.json()).toEqual({
				jsonrpc: "2.0",
				id: 1,
				result: { content: [{ type: "text", text: "get_selection" }] },
			});

			const refused = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(rpc("tools/list")),
			});

			expect(refused.status).toBe(401);

			const huge = new ReadableStream<Uint8Array>({
				start(controller) {
					for (let i = 0; i < 3; i++) controller.enqueue(new Uint8Array(512 * 1024).fill(32));
					controller.close();
				},
			});

			const tooLarge = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
				method: "POST",
				headers: { Authorization: `Bearer ${server.token}`, "Content-Type": "application/json" },
				body: huge,
			});

			expect(tooLarge.status).toBe(413);
			expect(await tooLarge.text()).toBe("");
		} finally {
			server.stop();
		}

		await expect(
			fetch(`http://127.0.0.1:${server.port}/mcp`, { method: "POST", body: "{}" }).then((r) => r.status),
		).rejects.toThrow();
	});
});
