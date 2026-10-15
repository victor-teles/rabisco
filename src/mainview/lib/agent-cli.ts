import { api } from "@/lib/rpc";
import { buildShareSnapshot } from "@/lib/share-snapshot";
import { checkDesign } from "@/views/editor/design-check";
import type { DesignTokens } from "../../shared/context/tokens";
import { exportSlug } from "../../shared/export/targets";
import type { CanvasDoc, Frame, ProjectFiles } from "../../shared/types";
import type { AgentCheck } from "./agent-tools";

export function agentCheckDesign(canvas: CanvasDoc, files: ProjectFiles, theme: DesignTokens) {
	return async (frames: Frame[]): Promise<AgentCheck[]> => {
		const results = await checkDesign(
			{ frames: canvas.frames, sections: canvas.sections ?? [], selected: frames, files, theme },
			() => {},
		);

		return results.map(({ frame, findings, error }) =>
			error ? { file: frame.file, findings, error } : { file: frame.file, findings },
		);
	};
}

/** Like Export as website, into a new folder inside `dir` */
export function agentExportWebsite(canvas: CanvasDoc, files: ProjectFiles, theme: DesignTokens) {
	return async (dir: string) => {
		const snapshot = await buildShareSnapshot({
			name: canvas.name,
			frames: canvas.frames,
			sections: canvas.sections ?? [],
			files,
			theme,
		});

		const written = await api.exportViewer({ dir, name: `${exportSlug(canvas.name)}-site`, snapshot });

		return written.dir;
	};
}
