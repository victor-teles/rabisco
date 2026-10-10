import type { Provider, ProviderCommand } from "../../shared/ai/contract";

/**
 * Commands are read from the tools' folders (`commands.ts`) and expanded here, not by the tool: CLI runs are
 * isolated from the user's settings, and Codex and Gemini don't expand commands in their non-interactive modes.
 * No file system here, so the mock provider still runs in the browser (`browser-generate.ts`).
 */
export type CommandFile = ProviderCommand & { template: string; syntax: "markdown" | "toml" };

/** The way each tool fills in arguments; a template without a placeholder gets them appended */
export function expandCommand(command: Pick<CommandFile, "template" | "syntax">, args: string) {
	const trimmed = args.trim();

	if (command.syntax === "toml") {
		if (command.template.includes("{{args}}")) return command.template.replaceAll("{{args}}", trimmed);

		return trimmed ? `${command.template}\n\n${trimmed}` : command.template;
	}

	const words = trimmed ? trimmed.split(/\s+/) : [];
	const placeholder = /\$ARGUMENTS|\$[1-9]/;

	if (!placeholder.test(command.template))
		return trimmed ? `${command.template}\n\nARGUMENTS: ${trimmed}` : command.template;

	return command.template
		.replaceAll("$ARGUMENTS", trimmed)
		.replace(/\$([1-9])/g, (_, n: string) => words[Number(n) - 1] ?? "");
}

/** The two `Provider` methods for a tool whose commands `read` finds. Read each time, so new files show up */
export function commandMethods(
	read: (projectPath: string) => CommandFile[],
): Required<Pick<Provider, "listCommands" | "expandCommand">> {
	return {
		async listCommands(projectPath) {
			return read(projectPath).map(({ name, description, argumentHint, source }) =>
				argumentHint ? { name, description, argumentHint, source } : { name, description, source },
			);
		},
		async expandCommand(projectPath, name, args) {
			const command = read(projectPath).find((candidate) => candidate.name === name);

			return command ? expandCommand(command, args) : null;
		},
	};
}
