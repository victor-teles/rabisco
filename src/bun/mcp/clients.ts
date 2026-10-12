import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { isJsonArray, isJsonObject, type Json, type JsonObject } from "../../shared/json";
import { AGENT_CLIENTS, type AgentClientId, type AgentClientStatus, type ClientSetup } from "../../shared/mcp/clients";
import { parseJson } from "../json";

export const SERVER_NAME = "rabisco";

/** How a client starts the stdio bridge; never a port or a token (decision 0030) */
export type BridgeLaunch = { command: string; args: string[] };

type RunResult = { ok: boolean; output: string };

export type ClientEnv = {
	home: string;
	platform: NodeJS.Platform;
	vars: Record<string, string | undefined>;
	which: (command: string) => string | null;
	run: (argv: string[]) => Promise<RunResult>;
};

type JsonFormat = { kind: "json"; key: "mcpServers" | "servers"; typed: boolean };

type ClientConfig = { file: string; format: JsonFormat | { kind: "toml" }; detect: string[]; cli?: string };

/** The command bundled with the app when it is there, else the npm package */
export function bridgeLaunch(bundled: string | null): BridgeLaunch {
	return bundled && existsSync(bundled)
		? { command: bundled, args: ["mcp"] }
		: { command: "npx", args: ["-y", "rabisco-mcp"] };
}

export function systemClientEnv(): ClientEnv {
	return {
		home: homedir(),
		platform: process.platform,
		vars: process.env,
		which: (command) => Bun.which(command),
		async run(argv) {
			const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });

			const [stdout, stderr, code] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);

			return { ok: code === 0, output: `${stdout}${stderr}`.trim() };
		},
	};
}

function appConfigDir({ home, platform, vars }: ClientEnv) {
	if (platform === "darwin") return join(home, "Library", "Application Support");

	if (platform === "win32") return vars["APPDATA"] ?? join(home, "AppData", "Roaming");

	return vars["XDG_CONFIG_HOME"] ?? join(home, ".config");
}

export function clientConfig(id: AgentClientId, env: ClientEnv): ClientConfig {
	const { home, vars } = env;

	switch (id) {
		case "claude-code": {
			const dir = vars["CLAUDE_CONFIG_DIR"] ?? home;

			return {
				file: join(dir, ".claude.json"),
				format: { kind: "json", key: "mcpServers", typed: true },
				detect: [join(dir, ".claude.json"), join(home, ".claude")],
				cli: "claude",
			};
		}

		case "codex": {
			const dir = vars["CODEX_HOME"] ?? join(home, ".codex");

			return { file: join(dir, "config.toml"), format: { kind: "toml" }, detect: [dir], cli: "codex" };
		}

		case "cursor":
			return {
				file: join(home, ".cursor", "mcp.json"),
				format: { kind: "json", key: "mcpServers", typed: false },
				detect: [join(home, ".cursor"), "/Applications/Cursor.app"],
			};
		case "vscode": {
			const dir = join(appConfigDir(env), "Code", "User");

			return {
				file: join(dir, "mcp.json"),
				format: { kind: "json", key: "servers", typed: true },
				detect: [dir],
			};
		}

		case "claude-desktop": {
			const dir = join(appConfigDir(env), "Claude");

			return {
				file: join(dir, "claude_desktop_config.json"),
				format: { kind: "json", key: "mcpServers", typed: false },
				detect: [dir],
			};
		}
	}
}

const sameLaunch = (command: Json | undefined, args: Json | undefined, launch: BridgeLaunch) =>
	command === launch.command &&
	isJsonArray(args) &&
	args.length === launch.args.length &&
	args.every((arg, index) => arg === launch.args[index]);

function readText(file: string) {
	try {
		return readFileSync(file, "utf-8");
	} catch {
		return null;
	}
}

function parseConfig(file: string, text: string | null): JsonObject {
	if (text === null || !text.trim()) return {};
	let root: Json;

	try {
		root = parseJson(text);
	} catch {
		throw new Error(`${file} isn't plain JSON, so Rabisco left it alone.`);
	}

	if (!isJsonObject(root)) throw new Error(`${file} doesn't hold a JSON object, so Rabisco left it alone.`);

	return root;
}

/** Same file mode as before, replaced in one step so the client never reads half a file */
function writeConfig(file: string, text: string) {
	mkdirSync(dirname(file), { recursive: true });
	const mode = existsSync(file) ? statSync(file).mode & 0o777 : 0o644;
	const temp = `${file}.rabisco-${process.pid}.tmp`;
	writeFileSync(temp, text, { mode });
	renameSync(temp, file);
}

const indentOf = (text: string | null) => /^([ \t]+)"/m.exec(text ?? "")?.[1] ?? "  ";

function jsonEntry(format: JsonFormat, launch: BridgeLaunch): JsonObject {
	return format.typed
		? { type: "stdio", command: launch.command, args: launch.args }
		: { command: launch.command, args: launch.args };
}

function jsonSetup(file: string, format: JsonFormat, launch: BridgeLaunch): ClientSetup {
	const servers = parseConfig(file, readText(file))[format.key];
	const entry = isJsonObject(servers) ? servers[SERVER_NAME] : undefined;

	if (!isJsonObject(entry)) return "none";

	return sameLaunch(entry["command"], entry["args"], launch) ? "current" : "outdated";
}

function writeJsonEntry(file: string, format: JsonFormat, entry: JsonObject | null) {
	const text = readText(file);
	const root = parseConfig(file, text);
	const current = root[format.key];
	const servers = isJsonObject(current) ? { ...current } : {};

	if (entry) servers[SERVER_NAME] = entry;
	else delete servers[SERVER_NAME];
	writeConfig(file, `${JSON.stringify({ ...root, [format.key]: servers }, null, indentOf(text))}\n`);
}

const TOML_TABLE = `mcp_servers.${SERVER_NAME}`;

const isTomlHeader = (line: string) => /^\s*\[/.test(line);

const isOurTable = (line: string) =>
	new RegExp(`^\\s*\\[\\s*${TOML_TABLE.replace(".", "\\.")}\\s*(\\]|\\.)`).test(line);

/** The lines of `[mcp_servers.rabisco]` and its subtables, and the rest of the file */
function splitToml(text: string) {
	const ours: string[] = [];
	const rest: string[] = [];
	let inside = false;

	for (const line of text.split("\n")) {
		if (isTomlHeader(line)) inside = isOurTable(line);
		(inside ? ours : rest).push(line);
	}

	return { ours, rest };
}

function tomlValue(lines: string[], key: string): Json | undefined {
	const line = lines.find((candidate) => new RegExp(`^\\s*${key}\\s*=`).test(candidate));

	try {
		return line === undefined ? undefined : parseJson(line.slice(line.indexOf("=") + 1).trim());
	} catch {
		return undefined;
	}
}

function tomlSetup(file: string, launch: BridgeLaunch): ClientSetup {
	const { ours } = splitToml(readText(file) ?? "");

	if (!ours.length) return "none";

	return sameLaunch(tomlValue(ours, "command"), tomlValue(ours, "args"), launch) ? "current" : "outdated";
}

function writeTomlEntry(file: string, launch: BridgeLaunch | null) {
	const rest = splitToml(readText(file) ?? "")
		.rest.join("\n")
		.trimEnd();

	const table = launch
		? [`[${TOML_TABLE}]`, `command = ${JSON.stringify(launch.command)}`, `args = ${JSON.stringify(launch.args)}`]
		: [];

	writeConfig(file, `${[rest, table.join("\n")].filter(Boolean).join("\n\n")}\n`);
}

function setupOf(id: AgentClientId, env: ClientEnv, launch: BridgeLaunch): ClientSetup {
	const { file, format } = clientConfig(id, env);

	try {
		return format.kind === "toml" ? tomlSetup(file, launch) : jsonSetup(file, format, launch);
	} catch {
		return "outdated";
	}
}

export function listClients(env: ClientEnv, launch: BridgeLaunch, connected: ReadonlySet<AgentClientId>) {
	return AGENT_CLIENTS.map(({ id, name }): AgentClientStatus => {
		const config = clientConfig(id, env);
		const detected = config.detect.some((path) => existsSync(path)) || (!!config.cli && !!env.which(config.cli));

		return { id, name, detected, setup: setupOf(id, env, launch), connected: connected.has(id) };
	});
}

/** Claude Code rewrites `~/.claude.json` while it runs, so its own CLI makes the change when it can */
async function claudeCli(env: ClientEnv, launch: BridgeLaunch | null) {
	const claude = env.which("claude");

	if (!claude) return false;
	await env.run([claude, "mcp", "remove", "--scope", "user", SERVER_NAME]);

	if (!launch) return true;

	const added = await env.run([
		claude,
		"mcp",
		"add-json",
		"--scope",
		"user",
		SERVER_NAME,
		JSON.stringify({ type: "stdio", command: launch.command, args: launch.args }),
	]);

	if (!added.ok) throw new Error(added.output || "`claude mcp add-json` failed.");

	return true;
}

/** Adds or replaces the `rabisco` server and leaves every other setting as it was */
export async function setUpClient(id: AgentClientId, env: ClientEnv, launch: BridgeLaunch | null) {
	const { file, format } = clientConfig(id, env);

	if (id === "claude-code" && (await claudeCli(env, launch))) return;

	if (!launch && !existsSync(file)) return;

	if (format.kind === "toml") writeTomlEntry(file, launch);
	else writeJsonEntry(file, format, launch && jsonEntry(format, launch));
}

export const removeClient = (id: AgentClientId, env: ClientEnv) => setUpClient(id, env, null);
