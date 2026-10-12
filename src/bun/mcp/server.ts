import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { isNumber, isString } from "../../shared/guards";
import { isJsonObject, type Json, type JsonObject } from "../../shared/json";
import { errorResult, findTool, TOOLS, type ToolResult } from "../../shared/mcp/tools";
import { parseJson } from "../json";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const MAX_BODY_BYTES = 1024 * 1024;

const INSTRUCTIONS =
	"Rabisco is a design canvas. Screens are React components in TSX, styled with Tailwind. These tools read the project open in Rabisco: the selection, a screen's code, its element tree and a screenshot.";

export type CallTool = (tool: string, args: JsonObject, client: string) => Promise<ToolResult>;

/** Told the client's name on every accepted request */
export type SeenClient = (client: string) => void;

export type McpOptions = { port: number; token: string; version: string; call: CallTool; seen?: SeenClient };

type JsonRpcId = string | number | null;

type JsonRpcReply = { jsonrpc: "2.0"; id: JsonRpcId; result: Json } | { jsonrpc: "2.0"; id: JsonRpcId; error: Json };

const digest = (text: string) => createHash("sha256").update(text).digest();

export const newToken = () => randomBytes(32).toString("hex");

export function sameToken(given: string, token: string) {
	return timingSafeEqual(digest(given), digest(token));
}

const failure = (status: number, message: string, headers: Record<string, string> = {}) =>
	new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });

const replyOf = (reply: JsonRpcReply) => Response.json(reply);

const errorReply = (id: JsonRpcId, code: number, message: string): JsonRpcReply => ({
	jsonrpc: "2.0",
	id,
	error: { code, message },
});

function idOf(message: JsonObject): JsonRpcId | undefined {
	const id = message["id"];

	return isString(id) || isNumber(id) || id === null ? id : undefined;
}

function protocolVersion(params: JsonObject) {
	const asked = params["protocolVersion"];

	return isString(asked) && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0]!;
}

function clientName(params: JsonObject) {
	const info = params["clientInfo"];
	const name = isJsonObject(info) ? info["name"] : undefined;

	return isString(name) ? name : undefined;
}

function checkRequest(request: Request, { port, token }: McpOptions): Response | null {
	const host = request.headers.get("host");

	if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return failure(403, "Unknown host");

	if (request.headers.has("origin")) return failure(403, "Requests from web pages are refused");
	const auth = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");

	if (!auth || !sameToken(auth[1]!, token)) return failure(401, "Unauthorized", { "WWW-Authenticate": "Bearer" });

	return null;
}

async function readBody(request: Request): Promise<Json | Response> {
	if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? ""))
		return failure(415, "Send application/json");
	const length = Number(request.headers.get("content-length") ?? 0);

	if (length > MAX_BODY_BYTES) return failure(413, "Request too large");
	const text = await request.text();

	if (text.length > MAX_BODY_BYTES) return failure(413, "Request too large");

	try {
		return parseJson(text);
	} catch {
		return replyOf(errorReply(null, -32700, "Parse error"));
	}
}

/** Stateless: every POST holds one JSON-RPC message and gets one JSON reply (decision 0030) */
export function createMcpHandler(options: McpOptions) {
	let lastClient = "agent";

	const callTool = async (params: JsonObject, client: string): Promise<Json> => {
		const name = params["name"];
		const args = params["arguments"] ?? {};

		if (!isString(name) || !findTool(name)) throw new RangeError(`Unknown tool: ${String(name)}`);

		if (!isJsonObject(args)) throw new RangeError("Tool arguments must be an object");

		try {
			return await options.call(name, args, client);
		} catch (error) {
			return errorResult(error instanceof Error ? error.message : String(error));
		}
	};

	const answer = async (method: string, params: JsonObject, client: string): Promise<Json> => {
		switch (method) {
			case "initialize":
				lastClient = clientName(params) ?? lastClient;

				return {
					protocolVersion: protocolVersion(params),
					capabilities: { tools: { listChanged: false } },
					serverInfo: { name: "rabisco", title: "Rabisco", version: options.version },
					instructions: INSTRUCTIONS,
				};
			case "ping":
				return {};
			case "tools/list":
				return { tools: TOOLS };
			case "tools/call":
				return callTool(params, client);
			default:
				throw new ReferenceError(`Method not found: ${method}`);
		}
	};

	return async (request: Request): Promise<Response> => {
		if (new URL(request.url).pathname !== "/mcp") return failure(404, "Not found");
		const refused = checkRequest(request, options);

		if (refused) return refused;

		if (request.method !== "POST") return failure(405, "Method not allowed", { Allow: "POST" });
		const message = await readBody(request);

		if (message instanceof Response) return message;

		if (!isJsonObject(message) || message["jsonrpc"] !== "2.0" || !isString(message["method"]))
			return replyOf(errorReply(null, -32600, "Invalid request"));
		const id = idOf(message);

		if (id === undefined) return new Response(null, { status: 202 });
		const params = message["params"] ?? {};

		if (!isJsonObject(params)) return replyOf(errorReply(id, -32602, "Params must be an object"));
		const client = request.headers.get("rabisco-client") ?? clientName(params) ?? lastClient;
		options.seen?.(client);

		try {
			return replyOf({ jsonrpc: "2.0", id, result: await answer(message["method"], params, client) });
		} catch (error) {
			const code = error instanceof ReferenceError ? -32601 : error instanceof RangeError ? -32602 : -32603;

			return replyOf(errorReply(id, code, error instanceof Error ? error.message : String(error)));
		}
	};
}

export type McpServer = { port: number; token: string; stop: () => void };

/** Loopback only, on a random port, with a new token each start */
export function startMcpServer(version: string, call: CallTool, seen?: SeenClient): McpServer {
	const token = newToken();
	let handle: (request: Request) => Promise<Response> = async () => failure(503, "Starting");
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handle(request) });
	const port = server.port ?? 0;
	handle = createMcpHandler({ port, token, version, call, seen });

	return { port, token, stop: () => void server.stop(true) };
}
