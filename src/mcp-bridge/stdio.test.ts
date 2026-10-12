import { expect, test } from "bun:test";
import { join } from "path";
import { tempDir } from "../bun/test-utils";
import { isJsonObject, type Json } from "../shared/json";
import { TOOLS } from "../shared/mcp/tools";
import { NOT_RUNNING } from "./client";

test("rabisco mcp answers initialize and tools/list with the app closed", async () => {
	const bridge = Bun.spawn(["bun", join(import.meta.dir, "index.ts"), "mcp"], {
		env: { ...process.env, RABISCO_MCP_FILE: join(tempDir(), "mcp.json") },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "ignore",
	});

	const send = (message: Json) => bridge.stdin.write(`${JSON.stringify(message)}\n`);
	const clientInfo = { name: "test", version: "1" };
	send({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo },
	});
	send({ jsonrpc: "2.0", method: "notifications/initialized" });
	send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
	send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_project", arguments: {} } });
	await bridge.stdin.flush();

	const results = new Map<Json | undefined, Json | undefined>();
	const decoder = new TextDecoder();
	let buffered = "";

	const reader = bridge.stdout.getReader();

	while (results.size < 3) {
		const { value, done } = await reader.read();

		if (done) break;
		buffered += decoder.decode(value);
		const lines = buffered.split("\n");
		buffered = lines.pop() ?? "";

		for (const line of lines) {
			const reply: Json = line ? JSON.parse(line) : null;

			if (isJsonObject(reply)) results.set(reply["id"], reply["result"]);
		}
	}

	bridge.kill();
	expect(results.get(1)).toMatchObject({ serverInfo: { name: "rabisco", title: "Rabisco" } });
	const listed = results.get(2);
	const tools = isJsonObject(listed) && Array.isArray(listed["tools"]) ? listed["tools"] : [];

	expect(tools.map((tool) => (isJsonObject(tool) ? tool["name"] : null))).toEqual(TOOLS.map((tool) => tool.name));
	expect(results.get(3)).toEqual({ content: [{ type: "text", text: NOT_RUNNING }], isError: true });
}, 20_000);
