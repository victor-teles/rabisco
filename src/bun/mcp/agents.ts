import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { isBoolean } from "../../shared/guards";
import { isJsonObject, type JsonObject } from "../../shared/json";
import { clientOfName, type AgentClientId } from "../../shared/mcp/clients";
import { errorResult, type AgentCall, type AgentServerStatus, type ToolResult } from "../../shared/mcp/tools";
import { parseJson } from "../json";
import { startMcpServer, type McpServer } from "./server";

export const AGENTS_FILE = "agents.json";

export const DISCOVERY_FILE = "mcp.json";

export const CALL_TIMEOUT_MS = 30_000;

export type Discovery =
	| { version: 1; enabled: true; port: number; token: string; pid: number; appVersion: string }
	| { version: 1; enabled: false; pid: number; appVersion: string };

type AgentsOptions = {
	userDataDir: string;
	appVersion: string;
	/** Pushes the call to the webview, which answers through `resolve` */
	send: (call: AgentCall) => void;
	discoveryFile?: string;
	timeoutMs?: number;
	start?: typeof startMcpServer;
};

function readEnabled(file: string) {
	try {
		const settings = parseJson(readFileSync(file, "utf-8"));

		return isJsonObject(settings) && isBoolean(settings["enabled"]) ? settings["enabled"] : false;
	} catch {
		return false;
	}
}

/** Owner-only, and replaced in one step so a client never reads half a file */
export function writePrivateJson(file: string, value: Discovery | { enabled: boolean }) {
	mkdirSync(dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(value, null, "\t")}\n`, { mode: 0o600 });
	chmodSync(temp, 0o600);
	renameSync(temp, file);
}

export function createAgentService(options: AgentsOptions) {
	const settingsFile = join(options.userDataDir, AGENTS_FILE);

	const discoveryFile =
		options.discoveryFile || process.env.RABISCO_MCP_FILE || join(options.userDataDir, DISCOVERY_FILE);

	const timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS;
	const start = options.start ?? startMcpServer;
	const pending = new Map<string, { resolve: (result: ToolResult) => void; timer: ReturnType<typeof setTimeout> }>();
	const connected = new Set<AgentClientId>();
	let enabled = readEnabled(settingsFile);
	let server: McpServer | null = null;
	let nextCall = 0;

	const call = (tool: string, args: JsonObject, client: string) =>
		new Promise<ToolResult>((resolve) => {
			const callId = `${Date.now().toString(36)}-${++nextCall}`;

			const timer = setTimeout(() => {
				pending.delete(callId);
				resolve(errorResult("Rabisco didn't answer in time. Try again."));
			}, timeoutMs);

			pending.set(callId, { resolve, timer });

			try {
				options.send({ callId, tool, args, client });
			} catch (error) {
				clearTimeout(timer);
				pending.delete(callId);
				resolve(errorResult(`Rabisco couldn't run the tool: ${String(error)}`));
			}
		});

	const seen = (client: string) => {
		const id = clientOfName(client);

		if (id) connected.add(id);
	};

	const serve = () => start(options.appVersion, call, seen);

	const writeDiscovery = () => {
		const base = { version: 1, pid: process.pid, appVersion: options.appVersion } as const;

		writePrivateJson(
			discoveryFile,
			server ? { ...base, enabled: true, port: server.port, token: server.token } : { ...base, enabled: false },
		);
	};

	const stopServer = () => {
		server?.stop();
		server = null;
		connected.clear();

		for (const [callId, { resolve, timer }] of pending) {
			clearTimeout(timer);
			pending.delete(callId);
			resolve(errorResult("The MCP server stopped."));
		}
	};

	const status = (): AgentServerStatus => ({ enabled, port: server?.port ?? null });

	return {
		/** At launch: serves when the setting is on, and writes the discovery file either way */
		init() {
			if (enabled) server = serve();
			writeDiscovery();

			return status();
		},
		status,
		/** Clients that called the server since it started */
		connected: (): ReadonlySet<AgentClientId> => connected,
		setEnabled(on: boolean) {
			enabled = on;
			writePrivateJson(settingsFile, { enabled });

			if (!on) stopServer();
			else server ??= serve();
			writeDiscovery();

			return status();
		},
		/** A new port and token: clients that held the old ones are refused */
		resetAccess() {
			stopServer();

			if (enabled) server = serve();
			writeDiscovery();

			return status();
		},
		resolve(callId: string, result: ToolResult) {
			const waiting = pending.get(callId);

			if (!waiting) return;
			clearTimeout(waiting.timer);
			pending.delete(callId);
			waiting.resolve(result);
		},
		close() {
			stopServer();
			rmSync(discoveryFile, { force: true });
		},
	};
}

export type AgentService = ReturnType<typeof createAgentService>;
