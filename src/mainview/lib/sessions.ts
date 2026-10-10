import { toast } from "sonner";
import { polishMode } from "@/hooks/use-auto-polish";
import { planMode } from "@/hooks/use-plan-mode";
import type { RenderFailure } from "@/lib/generation-session";
import { createProjectSessions } from "@/lib/project-sessions";
import { onFrameStatus } from "@/lib/render/frame-host";
import { api, onAssetsChanged, onFilesChanged, onGenerationEvent } from "@/lib/rpc";
import { checkDesign } from "@/views/editor/design-check";

const RENDER_CHECK_MS = 2500;

function watchRenderErrors(screens: string[]) {
	const watched = new Set(screens);
	const failures = new Map<string, RenderFailure>();

	if (!watched.size) return Promise.resolve<RenderFailure[]>([]);

	return new Promise<RenderFailure[]>((resolve) => {
		const unsubscribe = onFrameStatus((status) => {
			if (!watched.has(status.entry)) return;

			if (status.status === "error") {
				const file = status.error.file ?? status.entry;
				failures.set(status.entry, {
					entry: status.entry,
					problem: { path: file, message: status.error.message, line: status.error.line },
				});
			} else if (status.status === "rendered") failures.delete(status.entry);
		});

		setTimeout(() => {
			unsubscribe();
			resolve([...failures.values()]);
		}, RENDER_CHECK_MS);
	});
}

function reportSaveError(cause: unknown) {
	console.error("[rabisco] save failed", cause);
	toast.error("Couldn’t save changes", { id: "save-error", description: String(cause) });
}

export const projectSessions = createProjectSessions({
	api,
	onFilesChanged,
	onAssetsChanged,
	onGenerationEvent,
	onSaveError: reportSaveError,
	generation: {
		schedule: (callback) => {
			const frame = requestAnimationFrame(callback);

			return () => cancelAnimationFrame(frame);
		},
		check: (input) => checkDesign(input, () => {}),
		watchRenderErrors,
		polishMode,
		planMode,
	},
});
