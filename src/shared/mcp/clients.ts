export const AGENT_CLIENTS = [
	{ id: "claude-code", name: "Claude Code" },
	{ id: "codex", name: "Codex" },
	{ id: "cursor", name: "Cursor" },
	{ id: "vscode", name: "VS Code" },
	{ id: "claude-desktop", name: "Claude Desktop" },
] as const;

export type AgentClientId = (typeof AGENT_CLIENTS)[number]["id"];

/** `outdated`: a `rabisco` entry that launches something else, like an older app bundle */
export type ClientSetup = "none" | "current" | "outdated";

export type AgentClientStatus = {
	id: AgentClientId;
	name: string;
	/** The client or its config folder is on this computer */
	detected: boolean;
	setup: ClientSetup;
	/** Called the server since it started */
	connected: boolean;
};

/** The name Rabisco shows for a client, from what it sent as `clientInfo.name` */
export function agentName(name: string): string {
	const id = clientOfName(name);

	return AGENT_CLIENTS.find((client) => client.id === id)?.name ?? "Coding agent";
}

/** Maps the MCP `clientInfo.name` each client sends to the client it belongs to */
export function clientOfName(name: string): AgentClientId | null {
	const lower = name.toLowerCase();

	if (lower.includes("claude-code") || lower.includes("claude code")) return "claude-code";

	if (lower.includes("codex")) return "codex";

	if (lower.includes("cursor")) return "cursor";

	if (lower.includes("visual studio code") || lower.includes("vscode")) return "vscode";

	if (lower.includes("claude-ai") || lower.includes("claude desktop")) return "claude-desktop";

	return null;
}
