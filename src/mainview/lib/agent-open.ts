import { isString } from "../../shared/guards";
import type { JsonObject } from "../../shared/json";
import { errorResult, jsonResult, type ToolResult } from "../../shared/mcp/tools";

export const OPEN_TIMEOUT_MS = 20_000;

/** `null` while the editor loads the project */
export type EditorProject = { name: string } | { error: string } | null;

const isAbsolutePath = (path: string) => path.startsWith("/") || /^[a-z]:[\\/]/i.test(path);

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/[\\/]+$/, "") : path);

/** `open_project` from a coding agent: the app routes to the editor, which reports when the project loaded */
export function createAgentOpener(timeoutMs = OPEN_TIMEOUT_MS) {
	let navigate: ((path: string) => void) | null = null;
	let current: { path: string; project: EditorProject } | null = null;
	const waiting = new Map<string, Set<(project: EditorProject) => void>>();

	const resultOf = (path: string, project: EditorProject): ToolResult =>
		project === null
			? errorResult(`Rabisco is still opening ${path}. Try again.`)
			: "error" in project
				? errorResult(`Rabisco couldn't open ${path}: ${project.error}`)
				: jsonResult({ name: project.name, path });

	return {
		/** The app's router; `null` when it unmounts */
		handleOpen(handler: (path: string) => void) {
			navigate = handler;

			return () => {
				if (navigate === handler) navigate = null;
			};
		},
		/** The editor's project: loading, loaded or failed */
		editorProject(path: string, project: EditorProject) {
			current = { path, project };

			if (project === null) return;

			for (const resolve of waiting.get(path) ?? []) resolve(project);
			waiting.delete(path);
		},
		editorClosed(path: string) {
			if (current?.path === path) current = null;
		},
		async open(args: JsonObject): Promise<ToolResult> {
			const given = args["path"];

			if (!isString(given) || !isAbsolutePath(given.trim()))
				return errorResult("`path` must be an absolute folder path.");
			const path = trimSlash(given.trim());

			if (current?.path === path && current.project !== null) return resultOf(path, current.project);

			if (!navigate) return errorResult("Rabisco can't open a project right now. Try again.");

			const project = await new Promise<EditorProject>((resolve) => {
				const timer = setTimeout(() => {
					waiting.get(path)?.delete(done);
					resolve(null);
				}, timeoutMs);

				const done = (loaded: EditorProject) => {
					clearTimeout(timer);
					resolve(loaded);
				};

				waiting.set(path, (waiting.get(path) ?? new Set()).add(done));
				navigate?.(path);
			});

			return resultOf(path, project);
		},
	};
}

export const agentOpener = createAgentOpener();
