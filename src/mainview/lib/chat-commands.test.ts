import { describe, expect, test } from "bun:test";
import { BUILTIN_COMMANDS, chatCommands, matchesCommand, parseCommand, slashQuery } from "./chat-commands";

const commands = chatCommands(
	[
		{ name: "polish", description: "Polish a screen", argumentHint: "<screen>", source: "user" },
		// Taken by a built-in: Rabisco's wins
		{ name: "new", description: "Shadowed", source: "project" },
		{ name: "git:review", description: "Review", source: "user" },
	],
	"Claude Code",
);

describe("chat commands", () => {
	test("built-ins come first; a provider command can't take a built-in name", () => {
		expect(commands.slice(0, BUILTIN_COMMANDS.length)).toEqual(BUILTIN_COMMANDS);
		expect(commands.slice(BUILTIN_COMMANDS.length).map((command) => [command.name, command.group])).toEqual([
			["polish", "Claude Code"],
			["git:review", "Claude Code"],
		]);
	});

	test("the menu opens while the name is typed", () => {
		expect(slashQuery("/")).toBe("");
		expect(slashQuery("/git:re")).toBe("git:re");
		expect(slashQuery("/polish home")).toBeNull();
		expect(slashQuery("make it /bolder")).toBeNull();
	});

	test("parsing finds the command, its alias and the arguments", () => {
		expect(parseCommand("/polish the home screen ", commands)).toMatchObject({
			command: { name: "polish", kind: "provider" },
			args: "the home screen",
		});
		expect(parseCommand("/clear", commands)).toMatchObject({ command: { name: "new" }, args: "" });
		expect(parseCommand("/vary\nbolder\ndenser", commands)?.args).toBe("bolder\ndenser");
		expect(parseCommand("/unknown thing", commands)).toBeNull();
		expect(parseCommand("Make /polish work", commands)).toBeNull();
	});

	test("matching reads the name, the description and aliases", () => {
		const fresh = BUILTIN_COMMANDS[0]!;
		expect(matchesCommand("", fresh)).toBe(true);
		expect(matchesCommand("cle", fresh)).toBe(true);
		expect(matchesCommand("new chat", fresh)).toBe(true);
		expect(matchesCommand("design", fresh)).toBe(false);
	});
});
