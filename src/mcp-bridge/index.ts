import { mkdirSync, statSync, writeFileSync } from "fs";
import { version } from "../../package.json";
import { runCli } from "./cli";
import { createAppClient } from "./client";
import { launchApp } from "./launch";
import { serveStdio } from "./stdio";

const isDirectory = (path: string) => {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
};

const code = await runCli(process.argv.slice(2), {
	cwd: process.cwd(),
	version,
	app: createAppClient(),
	out: (text) => console.log(text),
	err: (text) => console.error(text),
	isDirectory,
	mkdir: (path) => mkdirSync(path, { recursive: true }),
	writeFile: (path, data) => writeFileSync(path, data),
	launch: async (folder) => launchApp(folder),
	serveStdio: () => serveStdio(version),
});

if (process.argv[2] !== "mcp") process.exit(code);
