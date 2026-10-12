import { basename, resolve } from "path";
import { isNumber, isString } from "../shared/guards";
import { isJsonArray, isJsonObject, type Json, type JsonObject } from "../shared/json";
import { EXPORT_WEBSITE, type ToolResult } from "../shared/mcp/tools";
import type { AppClient } from "./client";

export const USAGE = `Usage: rabisco <command> [options]

Commands:
  open <folder>                  Open a project folder in Rabisco
  check [screen…]                Run "Check design" on screens (default: every screen)
  screenshot <screen> [-o file]  Save a PNG of a screen (default: <screen>.png)
  export <folder>                Export the project as a website into a new folder in <folder>
  mcp                            Run the MCP server for coding agents on stdin and stdout

Options:
  --project <folder>  Open this project first (check, screenshot, export)
  --element <path>    With screenshot: one element, such as 0.1.2
  --json              With check: print the findings as JSON
  -h, --help          Show this help
  -v, --version       Show the version

check, screenshot and export need Rabisco running with
Settings → Agents → Let coding agents use Rabisco turned on.`;

export type CliIo = {
	cwd: string;
	version: string;
	app: AppClient;
	out: (text: string) => void;
	err: (text: string) => void;
	isDirectory: (path: string) => boolean;
	mkdir: (path: string) => void;
	writeFile: (path: string, data: Uint8Array) => void;
	/** Starts Rabisco, or brings it forward, and asks it to open `folder`. Returns an error sentence */
	launch: (folder: string) => Promise<string | null>;
	serveStdio: () => Promise<void>;
};

type Parsed = { command: string | null; positional: string[]; flags: Map<string, string | true> };

const VALUE_FLAGS = new Set(["--project", "--element", "-o", "--output"]);

class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): Parsed {
	const positional: string[] = [];
	const flags = new Map<string, string | true>();

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]!;
		const [name, inline] = arg.startsWith("--") && arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];

		if (!name!.startsWith("-") || name === "-") {
			positional.push(arg);
			continue;
		}

		if (!VALUE_FLAGS.has(name!)) {
			flags.set(name!, true);
			continue;
		}

		const value = inline ?? argv[++index];

		if (value === undefined) throw new UsageError(`${name} needs a value.`);
		flags.set(name === "--output" ? "-o" : name!, value);
	}

	return { command: positional.shift() ?? null, positional, flags };
}

const textOf = (result: ToolResult) =>
	result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");

function jsonOf(result: ToolResult): Json {
	try {
		// SAFETY: JSON.parse without a reviver only produces strings, numbers, booleans, null, arrays and plain objects
		return JSON.parse(textOf(result)) as Json;
	} catch {
		return null;
	}
}

function stringFlag(parsed: Parsed, name: string) {
	const value = parsed.flags.get(name);

	return isString(value) ? value : undefined;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** `Home (screens/home.tsx)` and its findings, one per line */
export function formatCheck(report: Json): string {
	if (!isJsonObject(report) || !isJsonArray(report["screens"])) return "Rabisco sent a report it can't read.";
	const lines: string[] = [];
	let checked = 0;

	for (const screen of report["screens"]) {
		if (!isJsonObject(screen)) continue;
		checked++;
		const findings = isJsonArray(screen["findings"]) ? screen["findings"] : [];
		const error = screen["error"];

		lines.push(`${String(screen["name"])} (${String(screen["file"])})`);

		if (isString(error)) lines.push(`  didn't render: ${error}`);

		if (!findings.length && !isString(error)) lines.push("  no findings");

		for (const finding of findings) {
			if (!isJsonObject(finding)) continue;

			const place = isNumber(finding["line"])
				? `${String(finding["file"])}:${finding["line"]}`
				: String(finding["file"]);

			lines.push(`  ${String(finding["severity"]).padEnd(7)} ${place}  ${String(finding["message"])}`);
		}
	}

	const errors = isNumber(report["errors"]) ? report["errors"] : 0;
	const warnings = isNumber(report["warnings"]) ? report["warnings"] : 0;

	lines.push("", `${plural(errors, "error")} and ${plural(warnings, "warning")} in ${plural(checked, "screen")}.`);

	return lines.join("\n");
}

/** `screens/home.tsx` or `Home` → `home.png` */
export function screenshotName(screen: string) {
	const base = basename(screen).replace(/\.tsx$/, "");

	const slug = base
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

	return `${slug || "screen"}.png`;
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
	const fail = (message: string, code = 1) => {
		io.err(message);

		return code;
	};

	let parsed: Parsed;

	try {
		parsed = parseArgs(argv);
	} catch (error) {
		return fail(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`, 2);
	}

	const { command, positional, flags } = parsed;

	if (flags.has("-v") || flags.has("--version")) {
		io.out(io.version);

		return 0;
	}

	if (command === "help" || flags.has("-h") || flags.has("--help")) {
		io.out(USAGE);

		return 0;
	}

	if (!command) return fail(USAGE, 2);

	const folderArg = (path: string | undefined, what: string) => {
		if (!path) throw new UsageError(`Give the ${what} folder.`);
		const folder = resolve(io.cwd, path);

		if (!io.isDirectory(folder)) throw new Error(`${folder} isn't a folder.`);

		return folder;
	};

	const call = async (tool: string, args: JsonObject = {}) => {
		const result = await io.app.callTool(tool, args);

		if (result.isError) throw new Error(textOf(result));

		return result;
	};

	const openProject = async (folder: string) => {
		const project = jsonOf(await call("open_project", { path: folder }));

		return isJsonObject(project) && isString(project["name"]) ? project["name"] : basename(folder);
	};

	try {
		const project = stringFlag(parsed, "--project");

		if (project && command !== "open" && command !== "mcp") await openProject(folderArg(project, "project"));

		switch (command) {
			case "mcp":
				await io.serveStdio();

				return 0;
			case "open": {
				const folder = folderArg(positional[0] ?? project, "project");

				if (io.app.running()) {
					io.out(`Opened ${await openProject(folder)} in Rabisco.`);

					return 0;
				}

				const problem = await io.launch(folder);

				if (problem) return fail(problem);
				io.out(`Opening ${folder} in Rabisco.`);

				return 0;
			}

			case "check": {
				const report = jsonOf(await call("check_design", positional.length ? { screens: positional } : {}));

				io.out(flags.has("--json") ? JSON.stringify(report, null, 2) : formatCheck(report));

				return isJsonObject(report) && isNumber(report["errors"]) && report["errors"] > 0 ? 1 : 0;
			}

			case "screenshot": {
				const screen = positional[0];

				if (!screen) throw new UsageError("Give the screen, by file or name.");
				const element = stringFlag(parsed, "--element");
				const result = await call("get_screenshot", element ? { screen, element } : { screen });
				const image = result.content.find((part) => part.type === "image");

				if (image?.type !== "image") return fail("Rabisco sent no image.");
				const output = resolve(io.cwd, stringFlag(parsed, "-o") ?? screenshotName(screen));
				io.writeFile(output, Buffer.from(image.data, "base64"));
				io.out(`Saved ${textOf(result) || screen} to ${output}`);

				return 0;
			}

			case "export": {
				const target = positional[0];

				if (!target) throw new UsageError("Give the folder to export into.");
				const folder = resolve(io.cwd, target);
				io.mkdir(folder);
				const result = await call(EXPORT_WEBSITE.name, { path: folder });
				io.out(`Exported the website to ${textOf(result)}`);

				return 0;
			}

			default:
				return fail(`Unknown command: ${command}\n\n${USAGE}`, 2);
		}
	} catch (error) {
		if (error instanceof UsageError) return fail(`${error.message}\n\n${USAGE}`, 2);

		return fail(error instanceof Error ? error.message : String(error));
	}
}
