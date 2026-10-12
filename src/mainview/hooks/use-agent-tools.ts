import { useEffect, useRef, type RefObject } from "react";
import { agentScreenshot } from "@/lib/agent-screenshot";
import { runAgentTool, type AgentElement, type AgentPoint } from "@/lib/agent-tools";
import { api, handleAgentCall } from "@/lib/rpc";
import { appliedTheme } from "../../shared/project";
import type { ProjectState } from "./use-project";

type Options = {
	stateRef: RefObject<ProjectState | null>;
	elements: readonly AgentElement[];
	elementAt: (file: string, point: AgentPoint) => Promise<AgentElement | null>;
};

/** While the editor shows a project, coding agents' tool calls read it (decision 0030) */
export function useAgentTools({ stateRef, elements, elementAt }: Options) {
	const latest = useRef({ elements, elementAt });

	useEffect(() => {
		latest.current = { elements, elementAt };
	});

	useEffect(
		() =>
			handleAgentCall(({ tool, args }) => {
				const state = stateRef.current;

				if (!state) return runAgentTool(tool, args, null);
				const { path, canvas, files } = state;

				return runAgentTool(tool, args, {
					path,
					canvas,
					files,
					elements: latest.current.elements,
					gitStatus: () => api.gitStatus({ path }),
					screenshot: agentScreenshot(files, appliedTheme(canvas, files)),
					elementAt: (file, point) => latest.current.elementAt(file, point),
				});
			}),
		[stateRef],
	);
}
