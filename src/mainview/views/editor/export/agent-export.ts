import { toast } from "sonner";
import { describeElement, type AgentElement } from "@/lib/agent-tools";
import { agentScreenshot } from "@/lib/agent-screenshot";
import { api } from "@/lib/rpc";
import type { DesignTokens } from "../../../../shared/context/tokens";
import { agentContextMarkdown, type AgentContextScreen } from "../../../../shared/export/agent-context";
import { resolveModes } from "../../../../shared/modes";
import { isScreenFile, screenNameFromPath } from "../../../../shared/project";
import type { CanvasSection, Frame, ProjectFiles } from "../../../../shared/types";

export type AgentCopyInput = {
	projectName: string;
	/** In canvas order */
	selected: Frame[];
	sections: readonly CanvasSection[];
	files: ProjectFiles;
	theme: DesignTokens;
	elements: readonly AgentElement[];
};

const shotName = (file: string) => `${file.replace(/^screens\//, "").replace(/\.tsx$/, "")}.png`;

/** Screenshots go to a temp folder the text points at; without them, the code and tokens still go */
async function contextText(input: AgentCopyInput, screens: Frame[]) {
	const { files, theme, sections } = input;
	const shoot = agentScreenshot(files, theme, sections);
	const shots = await Promise.all(screens.map((frame) => shoot(frame, null).catch(() => null)));

	const written = shots.flatMap((data, i) =>
		data ? [{ path: shotName(screens[i]!.file), content: data, encoding: "base64" as const }] : [],
	);

	const dir = written.length ? (await api.writeAgentContext({ files: written }).catch(() => null))?.dir : null;

	const context = screens.map((frame, i): AgentContextScreen => ({
		file: frame.file,
		name: frame.name || screenNameFromPath(frame.file),
		width: frame.width,
		height: frame.height,
		mode: resolveModes(frame, sections, theme),
		screenshot: dir && shots[i] ? `${dir}/${shotName(frame.file)}` : null,
		elements: input.elements.flatMap((element) => {
			const described = element.file === frame.file ? describeElement(files, element) : null;

			return described ? [{ path: described.path, line: described.line, label: described.label ?? "element" }] : [];
		}),
	}));

	return agentContextMarkdown({ project: input.projectName, screens: context, files, tokens: theme });
}

/** Copies the selected screens' code, tokens and screenshot paths as Markdown for a coding agent */
export async function copyForAgent(input: AgentCopyInput) {
	const screens = input.selected.filter((frame) => isScreenFile(frame.file));

	if (!screens.length) {
		toast("Select a screen to copy it for your agent");

		return;
	}

	const label =
		screens.length === 1 ? screens[0]!.name || screenNameFromPath(screens[0]!.file) : `${screens.length} screens`;

	const id = toast.loading(`Preparing ${label} for your agent…`);
	const text = contextText(input, screens);

	try {
		// A pending item keeps the click's permission to write the clipboard while the screenshots render
		await navigator.clipboard.write([
			new ClipboardItem({ "text/plain": text.then((markdown) => new Blob([markdown], { type: "text/plain" })) }),
		]);

		const shots = (await text).includes("\nScreenshot: ");

		toast.success(`Copied ${label} for your agent`, {
			id,
			description: shots
				? "Paste it into Claude Code, Codex or Cursor. It has the code, the tokens and a screenshot."
				: "Paste it into Claude Code, Codex or Cursor. It has the code and the tokens; the screenshot didn't render.",
		});
	} catch (error) {
		toast.error("Couldn't copy for your agent", {
			id,
			description: error instanceof Error ? error.message : String(error),
		});
	}
}
