import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tempDir } from "../test-utils";
import { commandMethods, expandCommand } from "./command-template";
import { claudeCommands, geminiCommands, parseMarkdownCommand } from "./commands";

function put(root: string, path: string, content: string) {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content);
}

describe("commands", () => {
	test("front matter gives the description and argument hint; the rest is the template", () => {
		const parsed = parseMarkdownCommand('---\ndescription: "Make it pop"\nargument-hint: <screen>\n---\nBolder $1\n');
		expect(parsed).toEqual({ fields: { description: "Make it pop", "argument-hint": "<screen>" }, body: "Bolder $1" });
		expect(parseMarkdownCommand("Just a prompt")).toEqual({ fields: {}, body: "Just a prompt" });
	});

	test("Claude commands: user and project folders, nested names, the project's wins", async () => {
		const home = tempDir();
		const project = tempDir();
		put(home, ".claude/commands/polish.md", "---\ndescription: Polish a screen\n---\nPolish $ARGUMENTS");
		put(home, ".claude/commands/brand/voice.md", "# Rewrite copy in the brand voice\nRewrite the copy.");
		put(home, ".claude/commands/empty.md", "---\ndescription: nothing\n---\n");
		put(home, ".claude/commands/notes.txt", "not a command");
		put(project, ".claude/commands/polish.md", "Polish it the project way");

		const commands = claudeCommands(project, home);
		expect(commands.map(({ name, description, source }) => [name, description, source])).toEqual([
			["brand:voice", "Rewrite copy in the brand voice", "user"],
			["polish", "Polish it the project way", "project"],
		]);
	});

	test("Gemini commands are TOML with a prompt", () => {
		const home = tempDir();
		put(home, ".gemini/commands/git/review.toml", 'description = "Review"\nprompt = """\nReview {{args}}\n"""\n');
		put(home, ".gemini/commands/broken.toml", "prompt = ");
		put(home, ".gemini/commands/no-prompt.toml", 'description = "x"');

		const [review, ...rest] = geminiCommands(tempDir(), home);
		expect(rest).toEqual([]);
		expect(review).toMatchObject({ name: "git:review", description: "Review", template: "Review {{args}}" });
		expect(expandCommand(review!, " the home screen ")).toBe("Review the home screen");
	});

	test("arguments fill $ARGUMENTS and $1…$9, or follow a template without placeholders", () => {
		const markdown = (template: string) => ({ template, syntax: "markdown" as const });
		expect(expandCommand(markdown("Make $ARGUMENTS bolder"), "the hero")).toBe("Make the hero bolder");
		expect(expandCommand(markdown("Swap $2 for $1, keep $3"), "red blue")).toBe("Swap blue for red, keep ");
		expect(expandCommand(markdown("Tidy the spacing"), "on home")).toBe("Tidy the spacing\n\nARGUMENTS: on home");
		expect(expandCommand(markdown("Tidy the spacing"), "")).toBe("Tidy the spacing");
		expect(expandCommand({ template: "Review", syntax: "toml" }, "home")).toBe("Review\n\nhome");
	});

	test("the provider methods list without templates and expand by name", async () => {
		const methods = commandMethods(() => [
			{ name: "brief", description: "Brief", source: "user", template: "Design $ARGUMENTS", syntax: "markdown" },
		]);

		expect(await methods.listCommands("/p")).toEqual([{ name: "brief", description: "Brief", source: "user" }]);
		expect(await methods.expandCommand("/p", "brief", "a shop")).toBe("Design a shop");
		expect(await methods.expandCommand("/p", "missing", "")).toBeNull();
	});
});
