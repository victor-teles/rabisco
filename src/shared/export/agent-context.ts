import { tokensToCss, type DesignTokens } from "../context/tokens";
import type { ResolvedMode } from "../modes";
import type { ProjectFiles } from "../types";
import { localDependencies } from "./code";
import { modeAttributes } from "./html";

export type AgentContextElement = { path: string; line: number; label: string };

export type AgentContextScreen = {
	file: string;
	name: string;
	width: number;
	height: number;
	/** Absolute path of the PNG, `null` when it didn't render */
	screenshot: string | null;
	elements: AgentContextElement[];
	mode?: ResolvedMode;
};

export type AgentContextInput = {
	project: string;
	screens: AgentContextScreen[];
	files: ProjectFiles;
	tokens: DesignTokens;
};

const LANGUAGES = new Map([
	["tsx", "tsx"],
	["ts", "ts"],
	["css", "css"],
]);

/** A fence longer than any backtick run in `text`, so code with Markdown in it stays one block */
function fenced(text: string, language: string) {
	const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
	const fence = "`".repeat(longest + 1);

	return `${fence}${language}\n${text.trimEnd()}\n${fence}`;
}

const languageOf = (file: string) => LANGUAGES.get(file.split(".").pop() ?? "") ?? "";

function modeLine(mode: ResolvedMode) {
	const options = Object.values(mode).join(", ");
	const attributes = modeAttributes(mode).trim();

	return attributes ? `Mode: ${options} (\`${attributes}\` on \`<html>\`)` : `Mode: ${options}`;
}

function screenSection(screen: AgentContextScreen, files: ProjectFiles) {
	const elements = screen.elements.map(
		(element) => `- \`${element.label}\` at line ${element.line} (element path \`${element.path}\`)`,
	);

	return [
		`## ${screen.name} (\`${screen.file}\`, ${screen.width} × ${screen.height})`,
		screen.mode ? modeLine(screen.mode) : "",
		screen.screenshot ? `Screenshot: ${screen.screenshot}` : "",
		elements.length ? `Selected elements:\n\n${elements.join("\n")}` : "",
		fenced(files[screen.file] ?? "", "tsx"),
	];
}

/** Markdown a coding agent can act on: what the screens are, their code, the components they import and the tokens */
export function agentContextMarkdown(input: AgentContextInput): string {
	const { files, screens } = input;
	const shown = new Set(screens.map((screen) => screen.file));
	const components = [...new Set(screens.flatMap((screen) => localDependencies(files, screen.file)))];
	const imported = components.filter((file) => !shown.has(file));
	const css = tokensToCss(input.tokens).trim();
	const names = screens.map((screen) => screen.name).join(", ");

	const intro =
		`${screens.length === 1 ? "This screen comes" : "These screens come"} from the Rabisco design "${input.project}". ` +
		"Each screen is a React component in TSX, styled with Tailwind v4, built on shadcn/ui (`@/components/ui/*`) " +
		"with lucide-react icons. Build them in this app with the same structure, components and tokens.";

	const parts = [
		`# Rabisco design: ${names}`,
		intro,
		...screens.flatMap((screen) => screenSection(screen, files)),
		imported.length ? "## Components the screens import" : "",
		...imported.map((file) => `### \`${file}\`\n\n${fenced(files[file] ?? "", languageOf(file))}`),
		css ? `## Design tokens\n\nThe CSS variables the screens use, from DESIGN.md.\n\n${fenced(css, "css")}` : "",
	];

	return `${parts.filter(Boolean).join("\n\n")}\n`;
}
