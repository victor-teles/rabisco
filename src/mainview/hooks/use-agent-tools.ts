import { useEffect, useRef, useState, type RefObject } from "react";
import { agentCheckDesign, agentExportWebsite } from "@/lib/agent-cli";
import { agentOpener, type EditorProject } from "@/lib/agent-open";
import { agentElementBox, agentScreenshot } from "@/lib/agent-screenshot";
import { runAgentTool, type AgentElement, type AgentPoint } from "@/lib/agent-tools";
import { api, handleAgentCall } from "@/lib/rpc";
import { projectSessions } from "@/lib/sessions";
import { agentVersion } from "@/lib/versions";
import { agentName } from "../../shared/mcp/clients";
import { appliedTheme } from "../../shared/project";
import type { ProjectState } from "./use-project";

type Options = {
	path: string;
	project: EditorProject;
	stateRef: RefObject<ProjectState | null>;
	elements: readonly AgentElement[];
	elementAt: (file: string, point: AgentPoint) => Promise<AgentElement | null>;
};

/** How long a screen keeps its "is editing" marker after an agent's last write to it */
const MARK_MS = 15_000;

const NO_MARKS: ReadonlyMap<string, string> = new Map();

/** While the editor shows a project, coding agents' tool calls read and change it (decision 0030) */
export function useAgentTools({ path, project, stateRef, elements, elementAt }: Options): ReadonlyMap<string, string> {
	const latest = useRef({ elements, elementAt });
	const [marks, setMarks] = useState(NO_MARKS);
	const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
	const name = project && "name" in project ? project.name : null;
	const error = project && "error" in project ? project.error : null;

	useEffect(() => {
		agentOpener.editorProject(path, error !== null ? { error } : name !== null ? { name } : null);
	}, [path, name, error]);

	useEffect(() => () => agentOpener.editorClosed(path), [path]);

	useEffect(() => {
		const pending = timers.current;

		return () => {
			for (const timer of pending.values()) clearTimeout(timer);
			pending.clear();
			setMarks(NO_MARKS);
		};
	}, [path]);

	useEffect(() => {
		latest.current = { elements, elementAt };
	});

	useEffect(() => {
		function mark(screens: string[], agent: string) {
			if (!screens.length) return;

			setMarks((current) => {
				const next = new Map(current);

				for (const file of screens) next.set(file, agent);

				return next;
			});

			for (const file of screens) {
				clearTimeout(timers.current.get(file));

				timers.current.set(
					file,
					setTimeout(() => {
						timers.current.delete(file);

						setMarks((current) => {
							const next = new Map(current);

							next.delete(file);

							return next;
						});
					}, MARK_MS),
				);
			}
		}

		return handleAgentCall(({ callId, tool, args, client }) => {
			const state = stateRef.current;
			const entry = state && projectSessions.get(state.path);

			if (!state || !entry) return runAgentTool(tool, args, null);
			const { path, canvas, files } = state;
			const agent = agentName(client);
			const theme = appliedTheme(canvas, files);

			return runAgentTool(tool, args, {
				path,
				canvas,
				files,
				elements: latest.current.elements,
				gitStatus: () => api.gitStatus({ path }),
				screenshot: agentScreenshot(files, theme, canvas.sections ?? []),
				elementAt: (file, point) => latest.current.elementAt(file, point),
				elementBox: agentElementBox(files, theme, canvas.sections ?? []),
				change: entry.session.change,
				step: `agent:${callId}`,
				log: ({ label, changed, screens }) => {
					const present = entry.session.get().state?.history.present;

					if (present) entry.session.addVersion(agentVersion(agent, label, present, changed, new Date()));
					mark(screens, agent);
				},
				busy: () => entry.controller.working(),
				checkDesign: agentCheckDesign(canvas, files, theme),
				exportWebsite: agentExportWebsite(canvas, files, theme),
			});
		});
	}, [stateRef]);

	return marks;
}
