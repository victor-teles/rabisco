import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createMcpHandler, newToken, type CallTool } from "../bun/mcp/server";
import { tempDir } from "../bun/test-utils";
import type { JsonObject } from "../shared/json";
import { errorResult, jsonResult, textResult, TOOLS } from "../shared/mcp/tools";
import { runCli, screenshotName, type CliIo } from "./cli";
import { createAppClient, NOT_RUNNING, REFUSED, SERVER_OFF } from "./client";
import { channelOfApp, discoveryFiles, enclosingApp, findDiscovery, OPEN_REQUEST_FILE } from "./discovery";
import { APP_NOT_FOUND, launchApp } from "./launch";

type Seen = { tool: string; args: JsonObject; client: string };

const REPORT = {
	errors: 1,
	warnings: 0,
	screens: [
		{
			file: "screens/home.tsx",
			name: "Home",
			error: null,
			findings: [
				{
					severity: "error",
					rule: "contrast",
					title: "Low contrast",
					message: "Text is hard to read",
					file: "screens/home.tsx",
					line: 12,
				},
			],
		},
		{ file: "screens/settings.tsx", name: "Settings", error: null, findings: [] },
	],
};

const fakeApp: CallTool = async (tool, args) => {
	switch (tool) {
		case "open_project":
			return jsonResult({ name: "Shop", path: String(args["path"]) });
		case "check_design":
			return jsonResult(REPORT);
		case "get_screenshot":
			return {
				content: [
					{ type: "image", data: Buffer.from("PNG!").toString("base64"), mimeType: "image/png" },
					{ type: "text", text: "Home (screens/home.tsx)" },
				],
			};
		case "export_website":
			return textResult(`${String(args["path"])}/shop-site`);
		default:
			return errorResult(`Rabisco has no tool \`${tool}\`.`);
	}
};

const servers: { stop: () => void }[] = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.stop();
});

/** The app's real MCP handler with fake tools, and a discovery file that points at it */
function startApp(call: CallTool = fakeApp) {
	const dir = tempDir();
	const file = join(dir, "mcp.json");
	const seen: Seen[] = [];
	let token = newToken();
	let handle: (request: Request) => Promise<Response> = async () => new Response(null, { status: 503 });
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handle(request) });
	const port = server.port ?? 0;
	servers.push({ stop: () => void server.stop(true) });

	const serve = () => {
		handle = createMcpHandler({
			port,
			token,
			version: "1.0.0",
			call: (tool, args, client) => {
				seen.push({ tool, args, client });

				return call(tool, args, client);
			},
		});
	};

	const discover = (body: JsonObject) => writeFileSync(file, JSON.stringify(body));

	serve();
	discover({ version: 1, enabled: true, port, token, pid: process.pid, appVersion: "1.0.0" });

	return {
		dir,
		file,
		port,
		seen,
		client: createAppClient({ locate: () => findDiscovery([file]) }),
		/** Like Reset access: a new token, and the file says so */
		resetAccess(writeFile = true) {
			token = newToken();
			serve();

			if (writeFile) discover({ version: 1, enabled: true, port, token, pid: process.pid, appVersion: "1.0.0" });
		},
		discover,
	};
}

function ioOf(app: ReturnType<typeof startApp>, overrides: Partial<CliIo> = {}) {
	const out: string[] = [];
	const err: string[] = [];
	const written = new Map<string, string>();
	const made: string[] = [];
	const launched: string[] = [];

	const io: CliIo = {
		cwd: app.dir,
		version: "1.0.0",
		app: app.client,
		out: (text) => out.push(text),
		err: (text) => err.push(text),
		isDirectory: (path) => path.startsWith("/"),
		mkdir: (path) => made.push(path),
		writeFile: (path, data) => written.set(path, Buffer.from(data).toString()),
		launch: async (folder) => (launched.push(folder), null),
		serveStdio: async () => {},
		...overrides,
	};

	return { io, out, err, written, made, launched };
}

describe("discovery", () => {
	test("RABISCO_MCP_FILE wins over the app data folders", () => {
		expect(discoveryFiles({ RABISCO_MCP_FILE: "/tmp/x.json" }, "darwin")).toEqual(["/tmp/x.json"]);

		expect(discoveryFiles({}, "linux").map((file) => file.split("/").slice(-3).join("/"))).toEqual([
			"app.rabisco.desktop/stable/mcp.json",
			"app.rabisco.desktop/canary/mcp.json",
			"app.rabisco.desktop/dev/mcp.json",
		]);
	});

	test("skips missing files and files left by an app that isn't running", () => {
		const dir = tempDir();
		const stale = join(dir, "stale.json");
		const live = join(dir, "live.json");
		writeFileSync(stale, JSON.stringify({ version: 1, enabled: false, pid: 999_999_999, appVersion: "1" }));
		writeFileSync(live, JSON.stringify({ version: 1, enabled: false, pid: process.pid, appVersion: "1" }));

		expect(findDiscovery([join(dir, "none.json"), stale, live])?.file).toBe(live);
		expect(findDiscovery([stale])).toBeNull();
	});

	test("finds the app bundle and its channel", () => {
		expect(enclosingApp("/Applications/Rabisco.app/Contents/MacOS/bin/rabisco")).toBe("/Applications/Rabisco.app");
		expect(enclosingApp("/usr/local/bin/rabisco")).toBeNull();
		expect(channelOfApp("/x/Rabisco-dev.app")).toBe("dev");
		expect(channelOfApp("/x/Rabisco-canary.app")).toBe("canary");
		expect(channelOfApp("/Applications/Rabisco.app")).toBe("stable");
	});
});

describe("createAppClient", () => {
	test("calls a tool and names the client", async () => {
		const app = startApp();
		const client = createAppClient({ locate: () => findDiscovery([app.file]), client: () => "claude-code" });

		expect(await client.callTool("open_project", { path: "/work/shop" })).toEqual(
			jsonResult({ name: "Shop", path: "/work/shop" }),
		);
		expect(app.seen).toEqual([{ tool: "open_project", args: { path: "/work/shop" }, client: "claude-code" }]);
		expect((await client.listTools())?.length).toBe(TOOLS.length);
	});

	test("says why it can't reach the app", async () => {
		const app = startApp();
		const missing = createAppClient({ locate: () => findDiscovery([join(app.dir, "none.json")]) });
		expect(await missing.callTool("get_project")).toEqual(errorResult(NOT_RUNNING));
		expect(await missing.listTools()).toBeNull();

		app.discover({ version: 1, enabled: false, pid: process.pid, appVersion: "1.0.0" });
		expect(await app.client.callTool("get_project")).toEqual(errorResult(SERVER_OFF));

		servers.splice(0)[0]!.stop();
		app.discover({ version: 1, enabled: true, port: app.port, token: "x", pid: process.pid, appVersion: "1" });
		expect(await app.client.callTool("get_project")).toEqual(errorResult(NOT_RUNNING));
	});

	test("reads the file again after a 401, then gives up", async () => {
		const app = startApp();
		app.resetAccess();
		expect((await app.client.callTool("check_design")).isError).toBeUndefined();

		app.resetAccess(false);
		expect(await app.client.callTool("check_design")).toEqual(errorResult(REFUSED));
	});
});

describe("runCli", () => {
	test("check prints the findings and fails on errors", async () => {
		const app = startApp();
		const { io, out } = ioOf(app);

		expect(await runCli(["check", "home"], io)).toBe(1);
		expect(app.seen.at(-1)).toEqual({ tool: "check_design", args: { screens: ["home"] }, client: "rabisco-cli" });
		expect(out.join("\n")).toBe(
			[
				"Home (screens/home.tsx)",
				"  error   screens/home.tsx:12  Text is hard to read",
				"Settings (screens/settings.tsx)",
				"  no findings",
				"",
				"1 error and 0 warnings in 2 screens.",
			].join("\n"),
		);

		expect(await runCli(["check", "--json"], ioOf(app).io)).toBe(1);
		expect(app.seen.at(-1)?.args).toEqual({});
	});

	test("screenshot saves the PNG", async () => {
		const app = startApp();
		const { io, out, written } = ioOf(app);

		expect(await runCli(["screenshot", "screens/home.tsx", "--element", "0.1"], io)).toBe(0);
		expect(app.seen.at(-1)?.args).toEqual({ screen: "screens/home.tsx", element: "0.1" });
		expect(written.get(join(app.dir, "home.png"))).toBe("PNG!");
		expect(out).toEqual([`Saved Home (screens/home.tsx) to ${join(app.dir, "home.png")}`]);

		expect(await runCli(["screenshot", "Home", "-o", "shots/h.png"], io)).toBe(0);
		expect(written.has(join(app.dir, "shots/h.png"))).toBe(true);
	});

	test("export writes into a new folder in the given one", async () => {
		const app = startApp();
		const { io, out, made } = ioOf(app);

		expect(await runCli(["export", "site"], io)).toBe(0);
		expect(made).toEqual([join(app.dir, "site")]);
		expect(app.seen.at(-1)).toEqual({
			tool: "export_website",
			args: { path: join(app.dir, "site") },
			client: "rabisco-cli",
		});
		expect(out).toEqual([`Exported the website to ${join(app.dir, "site")}/shop-site`]);
	});

	test("--project opens the project first", async () => {
		const app = startApp();
		const { io } = ioOf(app);

		expect(await runCli(["check", "--project", "/work/shop"], io)).toBe(1);
		expect(app.seen.map((each) => each.tool)).toEqual(["open_project", "check_design"]);
		expect(app.seen[0]?.args).toEqual({ path: "/work/shop" });
	});

	test("open goes through the server when it's on, and launches the app when it's not", async () => {
		const app = startApp();
		const running = ioOf(app);

		expect(await runCli(["open", "/work/shop"], running.io)).toBe(0);
		expect(running.out).toEqual(["Opened Shop in Rabisco."]);
		expect(running.launched).toEqual([]);

		app.discover({ version: 1, enabled: false, pid: process.pid, appVersion: "1.0.0" });
		const off = ioOf(app);
		expect(await runCli(["open", "/work/shop"], off.io)).toBe(0);
		expect(off.launched).toEqual(["/work/shop"]);
		expect(off.out).toEqual(["Opening /work/shop in Rabisco."]);
	});

	test("prints the app's sentence when a tool fails", async () => {
		const app = startApp();
		app.discover({ version: 1, enabled: false, pid: process.pid, appVersion: "1.0.0" });
		const { io, err } = ioOf(app);

		expect(await runCli(["screenshot", "home"], io)).toBe(1);
		expect(err).toEqual([SERVER_OFF]);
	});

	test("usage errors exit with 2", async () => {
		const app = startApp();

		for (const argv of [[], ["fly"], ["screenshot"], ["export"], ["open"], ["check", "--project"]]) {
			const { io, err } = ioOf(app);
			expect(await runCli(argv, io)).toBe(2);
			expect(err.join("\n")).toContain("Usage: rabisco");
		}

		const notFolder = ioOf(app, { isDirectory: () => false });
		expect(await runCli(["open", "nope"], notFolder.io)).toBe(1);
		expect(notFolder.err).toEqual([`${join(app.dir, "nope")} isn't a folder.`]);

		const help = ioOf(app);
		expect(await runCli(["--help"], help.io)).toBe(0);
		expect(await runCli(["-v"], help.io)).toBe(0);
		expect(help.out.at(-1)).toBe("1.0.0");
		expect(app.seen).toEqual([]);
	});

	test("names screenshots after the screen", () => {
		expect(screenshotName("screens/home.tsx")).toBe("home.png");
		expect(screenshotName("Order History")).toBe("order-history.png");
		expect(screenshotName("✨")).toBe("screen.png");
	});
});

describe("launchApp", () => {
	test("leaves the request next to the running app's discovery file and brings it forward", () => {
		const dir = tempDir();
		const file = join(dir, "mcp.json");
		const opened: string[][] = [];

		const problem = launchApp("/work/shop", {
			env: {},
			platform: "darwin",
			scriptPath: "/usr/local/bin/rabisco",
			locate: () => ({ file, discovery: { enabled: false, pid: 42, appVersion: "1" } }),
			executableOf: () => "/Applications/Rabisco.app/Contents/MacOS/cottontail",
			open: (args) => (opened.push(args), 0),
			now: () => 1000,
		});

		expect(problem).toBeNull();
		expect(opened).toEqual([["-a", "/Applications/Rabisco.app"]]);
		expect(JSON.parse(readFileSync(join(dir, OPEN_REQUEST_FILE), "utf-8"))).toEqual({
			version: 1,
			path: "/work/shop",
			at: 1000,
		});
	});

	test("starts the app it ships in, or any installed Rabisco, and says when there is none", () => {
		const dir = tempDir();
		const opened: string[][] = [];

		const base = {
			platform: "darwin" as const,
			locate: () => null,
			executableOf: () => null,
			open: (args: string[]) => (opened.push(args), 0),
		};

		launchApp("/work/shop", {
			...base,
			env: { RABISCO_MCP_FILE: join(dir, "mcp.json") },
			scriptPath: "/Applications/Rabisco-dev.app/Contents/Resources/rabisco.js",
		});
		launchApp("/work/shop", { ...base, env: { RABISCO_MCP_FILE: join(dir, "mcp.json") }, scriptPath: "/bin/x" });
		expect(opened).toEqual([
			["-a", "/Applications/Rabisco-dev.app"],
			["-b", "app.rabisco.desktop"],
		]);
		expect(existsSync(join(dir, OPEN_REQUEST_FILE))).toBe(true);

		const missing = launchApp("/work/shop", {
			...base,
			env: { RABISCO_MCP_FILE: join(dir, "mcp.json") },
			scriptPath: "/bin/x",
			open: () => 1,
		});

		expect(missing).toBe(APP_NOT_FOUND);
	});
});
