import { readFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import { isBoolean, isNumber, isString } from "../shared/guards";
import { isJsonObject, type Json } from "../shared/json";

export const APP_IDENTIFIER = "app.rabisco.desktop";

export const DISCOVERY_FILE = "mcp.json";

export const OPEN_REQUEST_FILE = "open.json";

export const CHANNELS = ["stable", "canary", "dev"] as const;

export type Channel = (typeof CHANNELS)[number];

export type Discovery =
	| { enabled: true; port: number; token: string; pid: number; appVersion: string }
	| { enabled: false; pid: number; appVersion: string };

export type Found = { file: string; discovery: Discovery };

type Env = Record<string, string | undefined>;

/** Where Electrobun keeps app data, per platform */
export function appDataDir(env: Env = process.env, platform = process.platform, home = homedir()) {
	if (platform === "darwin") return join(home, "Library", "Application Support");

	if (platform === "win32") return env["LOCALAPPDATA"] || join(home, "AppData", "Local");

	return env["XDG_DATA_HOME"] || join(home, ".local", "share");
}

export const userDataDir = (channel: Channel, env: Env = process.env, platform = process.platform) =>
	join(appDataDir(env, platform), APP_IDENTIFIER, channel);

/** `RABISCO_MCP_FILE` wins, as in the app (decision 0030) */
export function discoveryFiles(env: Env = process.env, platform = process.platform): string[] {
	const override = env["RABISCO_MCP_FILE"];

	if (override) return [override];

	return CHANNELS.map((channel) => join(userDataDir(channel, env, platform), DISCOVERY_FILE));
}

export function parseDiscovery(value: Json): Discovery | null {
	if (!isJsonObject(value) || value["version"] !== 1) return null;
	const { enabled, port, token, pid, appVersion } = value;

	if (!isNumber(pid) || !isBoolean(enabled)) return null;
	const version = isString(appVersion) ? appVersion : "";

	if (!enabled) return { enabled, pid, appVersion: version };

	return isNumber(port) && isString(token) ? { enabled, port, token, pid, appVersion: version } : null;
}

export function isAlive(pid: number) {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}

function readJson(file: string): Json | undefined {
	try {
		// SAFETY: JSON.parse without a reviver only produces strings, numbers, booleans, null, arrays and plain objects
		return JSON.parse(readFileSync(file, "utf-8")) as Json;
	} catch {
		return undefined;
	}
}

/** The first discovery file of a running app; a file left behind by a crash doesn't count */
export function findDiscovery(files = discoveryFiles(), alive = isAlive): Found | null {
	for (const file of files) {
		const json = readJson(file);
		const discovery = json === undefined ? null : parseDiscovery(json);

		if (discovery && alive(discovery.pid)) return { file, discovery };
	}

	return null;
}

/** `Rabisco-dev.app` keeps its data under `dev`, `Rabisco.app` under `stable` */
export function channelOfApp(appPath: string): Channel {
	const name = basename(appPath).toLowerCase();

	return name.includes("-dev") ? "dev" : name.includes("-canary") ? "canary" : "stable";
}

/** The `.app` bundle this script runs from, when it ships inside one */
export function enclosingApp(path: string): string | null {
	const match = /^(.*?\.app)(?:\/|$)/.exec(path);

	return match ? match[1]! : null;
}

export const openRequestFile = (discoveryFile: string) => join(dirname(discoveryFile), OPEN_REQUEST_FILE);
