import type { FrameHost } from "@/lib/render/frame-host";
import { renderOffstage } from "@/lib/render/offstage-render";
import type { SnapshotRaster } from "@/lib/render/protocol";
import type { DesignTokens } from "../../../shared/context/tokens";
import type { DesignFinding } from "../../../shared/design/findings";
import { withLines } from "../../../shared/design/locate";
import { sourceFindings } from "../../../shared/design/source-checks";
import { imageTargets } from "../../../shared/export/targets";
import type { Frame, ProjectFiles } from "../../../shared/types";

const PARALLEL = 3;

/** `error` when the screen didn't render; its source findings are still listed */
export type ScreenCheck = { frame: Frame; findings: DesignFinding[]; error?: string; image?: string };

export type DesignCheckInput = {
	frames: Frame[];
	selected: Frame[];
	files: ProjectFiles;
	theme: DesignTokens;
	raster?: (frame: Frame) => SnapshotRaster;
};

const SEVERITY_ORDER = { error: 0, warning: 1 } as const;

const byPlace = (a: DesignFinding, b: DesignFinding) =>
	SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
	(a.path ?? "").localeCompare(b.path ?? "") ||
	(a.line ?? 0) - (b.line ?? 0);

async function screenshot(host: FrameHost, raster: SnapshotRaster) {
	try {
		return (await host.snapshot(raster)).raster?.dataUrl;
	} catch {
		return undefined;
	}
}

async function checkScreen(frame: Frame, input: DesignCheckInput): Promise<ScreenCheck> {
	const source = input.files[frame.file] ?? "";
	const fromSource = sourceFindings(frame.file, source, input.theme);

	try {
		const { fromLayout, image } = await renderOffstage(frame, input.files, input.theme, async (host) => ({
			fromLayout: await host.lint(),
			image: input.raster ? await screenshot(host, input.raster(frame)) : undefined,
		}));

		const findings = withLines([...fromLayout, ...fromSource], input.files).sort(byPlace);

		return image ? { frame, findings, image } : { frame, findings };
	} catch (error) {
		return {
			frame,
			findings: fromSource.sort(byPlace),
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Without a selection, every screen except alternates. Results keep the canvas order */
export async function checkDesign(input: DesignCheckInput, onProgress: (done: number, total: number) => void) {
	const targets = imageTargets(input.frames, input.selected, input.files);
	const results: ScreenCheck[] = [];
	let next = 0;
	let done = 0;

	const worker = async () => {
		while (next < targets.length) {
			const index = next++;
			results[index] = await checkScreen(targets[index]!, input);
			onProgress(++done, targets.length);
		}
	};

	await Promise.all(Array.from({ length: Math.min(PARALLEL, targets.length) }, worker));

	return results;
}

/** What `bench/gen` reads back: findings per screen file, without canvas state */
export function designReport(results: ScreenCheck[]) {
	return {
		screens: results.map(({ frame, findings, error }) => ({ file: frame.file, error, findings })),
	};
}
