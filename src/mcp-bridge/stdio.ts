import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { JsonObject } from "../shared/json";
import { TOOLS } from "../shared/mcp/tools";
import { createAppClient } from "./client";

const INSTRUCTIONS =
	"Rabisco is a design canvas. Screens are React components in TSX, styled with Tailwind. These tools work on the project open in the Rabisco app: the selection, a screen's code, its element tree, screenshots and the design check. Rabisco must be running with Settings → Agents → Let coding agents use Rabisco turned on.";

/** `rabisco mcp`: answers `initialize` itself and forwards tools to the app, so it works with the app closed */
export async function serveStdio(version: string) {
	const server = new Server(
		{ name: "rabisco", title: "Rabisco", version },
		{ capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS },
	);

	const app = createAppClient({ client: () => server.getClientVersion()?.name ?? "agent" });

	server.setRequestHandler(ListToolsRequestSchema, async () => {
		// SAFETY: the app and the bundled list both send MCP tool definitions (decision 0030)
		const tools = ((await app.listTools()) ?? TOOLS) as Tool[];

		return { tools };
	});

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		// SAFETY: the arguments arrived as JSON on stdin, so they hold only JSON values
		const args = (request.params.arguments ?? {}) as JsonObject;

		return app.callTool(request.params.name, args);
	});

	await server.connect(new StdioServerTransport());
}
