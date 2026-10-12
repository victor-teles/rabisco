import { readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ProviderCommand } from "../../shared/ai/contract";
import { isDirectory } from "../project-folder";
import type { CommandFile } from "./command-template";

type CommandDir = { dir: string; source: ProviderCommand["source"] };

const MAX_DEPTH = 3;

/** `name.md` anywhere under `dir`; the path below `dir` is the name, joined with `:` */
function commandPaths(dir: string, extension: string, prefix: string[] = []): { name: string; path: string }[] {
	if (prefix.length > MAX_DEPTH || !isDirectory(dir)) return [];

	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);

		if (entry.isDirectory()) return commandPaths(path, extension, [...prefix, entry.name]);

		if (!entry.isFile() || !entry.name.endsWith(extension) || entry.name.startsWith(".")) return [];
		const name = [...prefix, entry.name.slice(0, -extension.length)].join(":");

		return /^[\w:.-]+$/.test(name) ? [{ name, path }] : [];
	});
}

const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2");

export type MarkdownCommand = { fields: Record<string, string>; body: string };

/** `---` front matter with `key: value` lines, then the template */
export function parseMarkdownCommand(text: string): MarkdownCommand {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	const fields: Record<string, string> = {};

	if (!match) return { fields, body: text.trim() };

	for (const line of match[1]!.split(/\r?\n/)) {
		const field = /^([\w-]+):\s*(.*)$/.exec(line);

		if (field) fields[field[1]!] = unquote(field[2]!);
	}

	return { fields, body: text.slice(match[0].length).trim() };
}

/** Without a description, the template's first line says what it does */
function describe(description: string | undefined, body: string) {
	return (
		description ||
		body
			.split("\n")
			.find((line) => line.trim())
			?.replace(/^#+\s*/, "") ||
		""
	)
		.trim()
		.slice(0, 120);
}

function readText(path: string) {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

export function readMarkdownCommands({ dir, source }: CommandDir): CommandFile[] {
	return commandPaths(dir, ".md").flatMap(({ name, path }) => {
		const text = readText(path);

		if (text === null) return [];
		const { fields, body } = parseMarkdownCommand(text);

		if (!body) return [];

		const command: CommandFile = {
			name,
			description: describe(fields.description, body),
			source,
			template: body,
		};

		if (fields["argument-hint"]) command.argumentHint = fields["argument-hint"];

		return [command];
	});
}

/** A project command wins over a user command of the same name, as in the tools themselves */
function merged(lists: CommandFile[][]) {
	const byName = new Map<string, CommandFile>();

	for (const list of lists) for (const command of list) byName.set(command.name, command);

	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const claudeCommands = (projectPath: string, home = homedir()) =>
	merged([
		readMarkdownCommands({ dir: join(home, ".claude/commands"), source: "user" }),
		readMarkdownCommands({ dir: join(projectPath, ".claude/commands"), source: "project" }),
	]);

export const codexCommands = (_projectPath: string, home = homedir()) =>
	merged([readMarkdownCommands({ dir: join(home, ".codex/prompts"), source: "user" })]);

export const antigravityCommands = (projectPath: string, home = homedir()) =>
	merged([
		readMarkdownCommands({ dir: join(home, ".gemini/config/global_workflows"), source: "user" }),
		readMarkdownCommands({ dir: join(projectPath, ".agents/workflows"), source: "project" }),
	]);
