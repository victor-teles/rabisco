import { existsSync, readdirSync, readFileSync } from "fs";
import { isAbsolute, join } from "path";
import { isString } from "../shared/guards";
import { isJsonObject, type Json, type JsonObject } from "../shared/json";
import type { RepoInfo } from "../shared/export/repo-sync";
import { assertExportPath } from "./export";

const TSCONFIGS = ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"];

/** tsconfig allows comments and trailing commas; strings keep their `//` */
const JSONC_NOISE = /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

function readJson(path: string): JsonObject | null {
	try {
		const text = readFileSync(path, "utf8")
			.replace(JSONC_NOISE, (_, string: string | undefined) => string ?? "")
			.replace(/,(\s*[}\]])/g, "$1");

		const parsed: Json = JSON.parse(text);

		return isJsonObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

const objectAt = (json: JsonObject | null, key: string) => {
	const value = json?.[key];

	return isJsonObject(value) ? value : null;
};

/** `@/` → `src/` from tsconfig `paths`, else `src/` when there is one */
function aliasRoot(dir: string, prefix: string): string | null {
	for (const name of TSCONFIGS) {
		const paths = objectAt(objectAt(readJson(join(dir, name)), "compilerOptions"), "paths");
		const targets = paths?.[`${prefix}*`];
		const first = Array.isArray(targets) ? targets[0] : undefined;

		if (isString(first)) return first.replace(/^\.\//, "").replace(/\*$/, "");
	}

	return prefix === "@/" ? (existsSync(join(dir, "src")) ? "src/" : "") : null;
}

/** `@/components/ui` → `src/components/ui` */
function aliasPath(dir: string, alias: string): string | null {
	const slash = alias.indexOf("/");

	if (slash < 0) return null;
	const root = aliasRoot(dir, alias.slice(0, slash + 1));

	return root === null ? null : `${root}${alias.slice(slash + 1)}`.replace(/\/+$/, "");
}

function uiModules(dir: string, uiDir: string) {
	const folder = join(dir, uiDir);

	if (!existsSync(folder)) return [];

	return readdirSync(folder, { recursive: true, encoding: "utf8" }).flatMap((file) =>
		/\.(tsx|ts|jsx|js)$/.test(file) ? [file.replace(/\.[jt]sx?$/, "")] : [],
	);
}

function packagesOf(dir: string) {
	const json = readJson(join(dir, "package.json"));

	if (!json) return null;

	return ["dependencies", "devDependencies", "peerDependencies"].flatMap((key) =>
		Object.keys(objectAt(json, key) ?? {}),
	);
}

/** What a sync needs to know about the repository at `dir` */
export function readRepoInfo(dir: string, paths: string[]): RepoInfo {
	if (!isAbsolute(dir) || !existsSync(dir)) throw new Error(`${dir} isn't a folder`);
	const aliases = objectAt(readJson(join(dir, "components.json")), "aliases");
	const uiAlias = isString(aliases?.ui) ? aliases.ui : null;
	const utilsAlias = isString(aliases?.utils) ? aliases.utils : null;
	const componentsAlias = isString(aliases?.components) ? aliases.components : "@/components";
	const uiDir = aliasPath(dir, uiAlias ?? "@/components/ui");

	return {
		existing: paths.filter((path) => existsSync(assertExportPath(dir, path))),
		uiAlias,
		utilsAlias,
		uiModules: uiDir === null ? null : uiModules(dir, uiDir),
		packages: packagesOf(dir),
		componentsDir: aliasPath(dir, componentsAlias) ?? "components",
	};
}
