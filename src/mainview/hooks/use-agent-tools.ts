import { useEffect, useRef, type RefObject } from "react";
import { agentCheckDesign, agentExportWebsite } from "@/lib/agent-cli";
import { agentOpener, type EditorProject } from "@/lib/agent-open";
import { agentScreenshot } from "@/lib/agent-screenshot";
import { runAgentTool, type AgentElement, type AgentPoint } from "@/lib/agent-tools";
import { api, handleAgentCall } from "@/lib/rpc";
import { appliedTheme } from "../../shared/project";
import type { ProjectState } from "./use-project";

type Options = {
	path: string;
	project: EditorProject;
	stateRef: RefObject<ProjectState | null>;
	elements: readonly AgentElement[];
	elementAt: (file: string, point: AgentPoint) => Promise<AgentElement | null>;
};

/** While the editor shows a project, coding agents' tool calls read it (decision 0030) */
export function useAgentTools({ path, project, stateRef, elements, elementAt }: Options) {
	const latest = useRef({ elements, elementAt });
	const name = project && "name" in project ? project.name : null;
	const error = project && "error" in project ? project.error : null;

	useEffect(() => {
		agentOpener.editorProject(path, error !== null ? { error } : name !== null ? { name } : null);
	}, [path, name, error]);

	useEffect(() => () => agentOpener.editorClosed(path), [path]);

	useEffect(() => {
		latest.current = { elements, elementAt };
	});

	useEffect(
		() =>
			handleAgentCall(({ tool, args }) => {
				const state = stateRef.current;

				if (!state) return runAgentTool(tool, args, null);
				const { path, canvas, files } = state;
				const theme = appliedTheme(canvas, files);

				return runAgentTool(tool, args, {
					path,
					canvas,
					files,
					elements: latest.current.elements,
					gitStatus: () => api.gitStatus({ path }),
					screenshot: agentScreenshot(files, theme),
					elementAt: (file, point) => latest.current.elementAt(file, point),
					checkDesign: agentCheckDesign(canvas, files, theme),
					exportWebsite: agentExportWebsite(canvas, files, theme),
				});
			}),
		[stateRef],
	);
}
