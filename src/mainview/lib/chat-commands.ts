import type { ProviderCommand } from "../../shared/ai/contract";

export type BuiltinCommandName = "new" | "product-md" | "design-md" | "vary" | "compare" | "play";

export type ChatCommand = {
	name: string;
	description: string;
	argumentHint?: string;
	/** Other names it answers to; not listed */
	aliases?: string[];
	/** Rabisco's own, or the provider's (sent to it as a prompt) */
	kind: "builtin" | "provider";
	/** Heading in the menu */
	group: string;
};

export const BUILTIN_COMMANDS: (ChatCommand & { name: BuiltinCommandName })[] = [
	{ name: "new", aliases: ["clear"], description: "Start a new chat", kind: "builtin", group: "Rabisco" },
	{ name: "product-md", description: "Write PRODUCT.md with a short interview", kind: "builtin", group: "Rabisco" },
	{ name: "design-md", description: "Write DESIGN.md from the screens", kind: "builtin", group: "Rabisco" },
	{
		name: "vary",
		description: "New variations of the selected screen",
		argumentHint: "[direction]",
		kind: "builtin",
		group: "Rabisco",
	},
	{ name: "compare", description: "Compare the selected screen's variations", kind: "builtin", group: "Rabisco" },
	{ name: "play", description: "Play the prototype", kind: "builtin", group: "Rabisco" },
];

export const isBuiltin = (command: ChatCommand): command is ChatCommand & { name: BuiltinCommandName } =>
	command.kind === "builtin";

/** Built-ins first; a provider command can't take a built-in's name */
export function chatCommands(provider: ProviderCommand[], providerLabel: string): ChatCommand[] {
	const taken = new Set(BUILTIN_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]));

	const own = provider.flatMap((command): ChatCommand[] => {
		if (taken.has(command.name)) return [];

		const entry: ChatCommand = {
			name: command.name,
			description: command.description,
			kind: "provider",
			group: providerLabel,
		};

		if (command.argumentHint) entry.argumentHint = command.argumentHint;

		return [entry];
	});

	return [...BUILTIN_COMMANDS, ...own];
}

/** What follows the slash while the name is being typed; `null` once there is a space, or no slash */
export function slashQuery(text: string) {
	const match = /^\/([\w:.-]*)$/.exec(text);

	return match ? match[1]! : null;
}

const answersTo = (command: ChatCommand, name: string) =>
	command.name === name || Boolean(command.aliases?.includes(name));

/** `/name args` for a known command; anything else is a plain prompt */
export function parseCommand(text: string, commands: readonly ChatCommand[]) {
	const match = /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());

	if (!match) return null;
	const command = commands.find((candidate) => answersTo(candidate, match[1]!));

	return command ? { command, args: (match[2] ?? "").trim() } : null;
}

/** The words a command is found by; the same test the command menu filters with */
export const commandKeywords = (command: ChatCommand) => [command.description, ...(command.aliases ?? [])];

export function matchesCommand(query: string, command: ChatCommand) {
	const haystack = [command.name, ...commandKeywords(command)].join(" ").toLowerCase();

	return query
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((term) => haystack.includes(term));
}
