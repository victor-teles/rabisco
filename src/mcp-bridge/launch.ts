import { spawnSync } from "child_process";
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
	APP_IDENTIFIER,
	channelOfApp,
	DISCOVERY_FILE,
	enclosingApp,
	findDiscovery,
	openRequestFile,
	userDataDir,
	type Found,
} from "./discovery";

export const APP_NOT_FOUND =
	"Couldn't find the Rabisco app. Install it, or set RABISCO_APP to the path of Rabisco.app.";

type Env = Record<string, string | undefined>;

export type LaunchOptions = {
	env?: Env;
	platform?: NodeJS.Platform;
	/** Where this script runs from, to find the app bundle around it */
	scriptPath?: string;
	locate?: () => Found | null;
	/** The executable of a running process */
	executableOf?: (pid: number) => string | null;
	/** Runs `open` and returns its exit code */
	open?: (args: string[]) => number;
	now?: () => number;
};

function executableOfPid(pid: number) {
	const result = spawnSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf-8" });

	return result.status === 0 ? result.stdout.trim() || null : null;
}

const runOpen = (args: string[]) => spawnSync("open", args, { stdio: "ignore" }).status ?? 1;

/** The app to start: `RABISCO_APP`, the running app, the bundle this script ships in, or any installed Rabisco */
function appOf(options: Required<Pick<LaunchOptions, "env" | "scriptPath" | "executableOf">>, running: Found | null) {
	const fromPid = running ? options.executableOf(running.discovery.pid) : null;

	return options.env["RABISCO_APP"] || (fromPid && enclosingApp(fromPid)) || enclosingApp(options.scriptPath) || null;
}

/** Owner-only, written in one step so the app never reads half a file */
function writeRequest(file: string, path: string, at: number) {
	mkdirSync(dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify({ version: 1, path, at })}\n`, { mode: 0o600 });
	chmodSync(temp, 0o600);
	renameSync(temp, file);
}

/**
 * Leaves `open.json` next to the discovery file, then starts the app or brings it forward.
 * Rabisco reads the request when it starts and when it is opened again, so this works with the MCP server off.
 */
export function launchApp(folder: string, options: LaunchOptions = {}): string | null {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const scriptPath = options.scriptPath ?? process.argv[1] ?? "";
	const executableOf = options.executableOf ?? executableOfPid;
	const running = (options.locate ?? (() => findDiscovery()))();
	const app = appOf({ env, scriptPath, executableOf }, running);

	const discoveryFile =
		running?.file ||
		env["RABISCO_MCP_FILE"] ||
		join(userDataDir(app ? channelOfApp(app) : "stable", env, platform), DISCOVERY_FILE);

	writeRequest(openRequestFile(discoveryFile), folder, (options.now ?? Date.now)());

	if (platform !== "darwin") return running ? null : `Start Rabisco and it opens ${folder}.`;
	const code = (options.open ?? runOpen)(app ? ["-a", app] : ["-b", APP_IDENTIFIER]);

	return code === 0 ? null : APP_NOT_FOUND;
}
