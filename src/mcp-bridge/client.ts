import { isString } from "../shared/guards";
import { isJsonArray, isJsonObject, type Json, type JsonObject } from "../shared/json";
import { errorResult, type ToolContent, type ToolResult } from "../shared/mcp/tools";
import { findDiscovery, type Found } from "./discovery";

export const NOT_RUNNING = "Rabisco isn't running. Open Rabisco and try again.";

export const SERVER_OFF = "The MCP server is off. Turn on Settings → Agents → Let coding agents use Rabisco.";

export const REFUSED = "Rabisco refused the token. Reset access in Settings → Agents.";

type ClientOptions = {
	locate?: () => Found | null;
	fetch?: typeof fetch;
	/** The MCP client's name, such as `claude-code`, so Rabisco can say who made a change */
	client?: () => string;
};

type Reply = { result: Json } | { error: string };

class Unreachable extends Error {}

function parseContent(value: Json): ToolContent | null {
	if (!isJsonObject(value)) return null;

	if (value["type"] === "text" && isString(value["text"])) return { type: "text", text: value["text"] };

	if (value["type"] === "image" && isString(value["data"]))
		return { type: "image", data: value["data"], mimeType: "image/png" };

	return null;
}

export function parseToolResult(value: Json): ToolResult | null {
	if (!isJsonObject(value) || !isJsonArray(value["content"])) return null;
	const content = value["content"].flatMap((each) => parseContent(each) ?? []);

	return value["isError"] === true ? { content, isError: true } : { content };
}

const replyError = (reply: JsonObject) => {
	const error = reply["error"];
	const message = isJsonObject(error) ? error["message"] : undefined;

	return isString(message) ? message : "Rabisco sent an error without a message.";
};

/** Talks to the app's MCP server through the discovery file, and turns every failure into a sentence */
export function createAppClient(options: ClientOptions = {}) {
	const locate = options.locate ?? (() => findDiscovery());
	const send = options.fetch ?? fetch;
	const client = options.client ?? (() => "rabisco-cli");
	let nextId = 0;

	async function post(found: Found, body: JsonObject): Promise<Response> {
		if (!found.discovery.enabled) throw new Unreachable(SERVER_OFF);
		const { port, token } = found.discovery;

		try {
			return await send(`http://127.0.0.1:${port}/mcp`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
					"Rabisco-Client": client(),
				},
				body: JSON.stringify(body),
			});
		} catch {
			throw new Unreachable(NOT_RUNNING);
		}
	}

	async function request(method: string, params: JsonObject): Promise<Reply> {
		const body = { jsonrpc: "2.0", id: ++nextId, method, params };

		try {
			let found = locate();

			if (!found) return { error: NOT_RUNNING };
			let response = await post(found, body);

			// The server restarted with a new token: read the file once more
			if (response.status === 401) {
				found = locate();

				if (!found) return { error: NOT_RUNNING };
				response = await post(found, body);
			}

			if (response.status === 401) return { error: REFUSED };

			if (!response.ok) return { error: `Rabisco answered ${response.status}: ${await response.text()}` };
			// SAFETY: Response.json() parses JSON text, which only produces Json values
			const reply = (await response.json()) as Json;

			if (!isJsonObject(reply)) return { error: "Rabisco sent a reply that isn't JSON-RPC." };

			return "error" in reply ? { error: replyError(reply) } : { result: reply["result"] ?? null };
		} catch (error) {
			if (error instanceof Unreachable) return { error: error.message };

			return { error: `Couldn't reach Rabisco: ${error instanceof Error ? error.message : String(error)}` };
		}
	}

	return {
		/** `null` when the app isn't running or its server is off */
		running: () => {
			const found = locate();

			return found?.discovery.enabled ? found : null;
		},
		locate,
		async callTool(name: string, args: JsonObject = {}): Promise<ToolResult> {
			const reply = await request("tools/call", { name, arguments: args });

			if ("error" in reply) return errorResult(reply.error);

			return parseToolResult(reply.result) ?? errorResult("Rabisco sent a tool result without content.");
		},
		/** The app's list, or `null` when it can't be reached */
		async listTools(): Promise<readonly Json[] | null> {
			const reply = await request("tools/list", {});

			if ("error" in reply || !isJsonObject(reply.result)) return null;
			const tools = reply.result["tools"];

			return isJsonArray(tools) ? tools : null;
		},
	};
}

export type AppClient = ReturnType<typeof createAppClient>;
