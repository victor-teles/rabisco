// Writes each code export of the fixture project to a temp folder, then installs, typechecks and builds it.
// `bun tools/check-exports.ts [target…]`; a failed export's folder is kept so you can look at it.

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeExportFiles } from "../src/bun/export";
import { componentLibrary } from "../src/shared/export/component-library";
import { exportFixture } from "../src/shared/export/export-fixture";
import { nextProject } from "../src/shared/export/next-project";
import { reactRouterProject } from "../src/shared/export/react-router-project";
import { viteProject } from "../src/shared/export/vite-project";
import type { ExportFile } from "../src/shared/types";

type Target = () => { files: ExportFile[]; warnings: string[] };

const TARGETS = new Map<string, Target>([
	["vite", () => viteProject(exportFixture())],
	["next", () => nextProject(exportFixture())],
	["react-router", () => reactRouterProject(exportFixture())],
	["components", () => componentLibrary(exportFixture())],
]);

const chosen = process.argv.slice(2);

const unknown = chosen.filter((name) => !TARGETS.has(name));

if (unknown.length) {
	console.error(`Unknown target ${unknown.join(", ")}. Targets: ${[...TARGETS.keys()].join(", ")}`);
	process.exit(2);
}

// A `BASH_ENV` that resets PATH (agent shells set one) hides node_modules/.bin from `bun run`
const { BASH_ENV: _, ...env } = process.env;

function run(dir: string, command: string[]) {
	console.log(`$ ${command.join(" ")}`);

	return Bun.spawnSync(command, { cwd: dir, env, stdout: "inherit", stderr: "inherit" }).exitCode === 0;
}

const failed: string[] = [];

for (const name of chosen.length ? chosen : [...TARGETS.keys()]) {
	const project = TARGETS.get(name)!();
	const dir = mkdtempSync(join(tmpdir(), `rabisco-export-${name}-`));
	console.log(`\n== ${name}: ${dir}`);
	writeExportFiles(dir, project.files);

	for (const warning of project.warnings) console.warn(`warning: ${warning}`);

	const ok =
		project.warnings.length === 0 &&
		run(dir, ["bun", "install"]) &&
		run(dir, ["bun", "run", "typecheck"]) &&
		run(dir, ["bun", "run", "build"]);

	if (ok) rmSync(dir, { recursive: true, force: true });
	else failed.push(`${name} (${dir})`);
}

if (failed.length) {
	console.error(`\nFailed: ${failed.join(", ")}`);
	process.exit(1);
}

console.log("\nEvery export installs, typechecks and builds.");
