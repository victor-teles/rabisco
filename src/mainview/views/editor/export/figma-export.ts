import { toast } from "sonner";
import { figmaFonts } from "@/lib/figma-fonts";
import type { FigmaExportReply, FigmaExportRequest, FigmaExportScreen } from "@/lib/figma-export-worker";
import type { FontFile } from "../../../../shared/export/figma/font";
import { renderOffstage } from "@/lib/render/offstage-render";
import type { DesignTokens } from "../../../../shared/context/tokens";
import { resolveDraft, resolveModes } from "../../../../shared/modes";
import { screenNameFromPath } from "../../../../shared/project";
import type { CanvasSection, Frame, ProjectFiles } from "../../../../shared/types";

const ENCODE_TIMEOUT_MS = 60_000;

export type FigmaCopyInput = {
	selected: Frame[];
	sections: readonly CanvasSection[];
	files: ProjectFiles;
	theme: DesignTokens;
};

const nameOf = (frame: Frame) => frame.name || screenNameFromPath(frame.file);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

type Encoded = { html: string; copied: number; fixed: number; skipped: number };

async function capture(
	frames: Frame[],
	sections: readonly CanvasSection[],
	files: ProjectFiles,
	theme: DesignTokens,
	fonts: FontFile[],
) {
	const left = Math.min(...frames.map((frame) => frame.x));
	const top = Math.min(...frames.map((frame) => frame.y));
	const screens: FigmaExportScreen[] = [];

	for (const frame of frames) {
		const { tree, images } = await renderOffstage(
			frame,
			files,
			theme,
			resolveModes(frame, sections, theme),
			(host) => host.figmaCapture(fonts),
			resolveDraft(frame, sections),
		);

		screens.push({ name: nameOf(frame), x: frame.x - left, y: frame.y - top, tree, images });
	}

	return screens;
}

function encode(request: FigmaExportRequest): Promise<Encoded> {
	const worker = new Worker(new URL("../../../lib/figma-export-worker.ts", import.meta.url), { type: "module" });

	return new Promise<Encoded>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Encoding for Figma took too long")), ENCODE_TIMEOUT_MS);

		worker.addEventListener("message", (event: MessageEvent<FigmaExportReply>) => {
			clearTimeout(timer);

			if ("error" in event.data) reject(new Error(event.data.error));
			else resolve(event.data);
		});
		worker.addEventListener("error", () => {
			clearTimeout(timer);
			reject(new Error("Encoding for Figma failed"));
		});
		worker.postMessage(request);
	}).finally(() => worker.terminate());
}

export async function copyToFigma({ selected, sections, files, theme }: FigmaCopyInput) {
	if (!selected.length) {
		toast("Select a screen to copy it to Figma");

		return;
	}

	const label = selected.length === 1 ? nameOf(selected[0]!) : plural(selected.length, "screen");
	const id = toast.loading(`Copying ${label} to Figma…`);

	const encoded = figmaFonts().then(async (fonts) =>
		encode({ screens: await capture(selected, sections, files, theme, fonts), fonts }),
	);

	try {
		await navigator.clipboard.write([
			new ClipboardItem({
				"text/html": encoded.then(({ html }) => new Blob([html], { type: "text/html" })),
				"text/plain": encoded.then(
					({ copied }) => new Blob([selected.slice(0, copied).map(nameOf).join("\n")], { type: "text/plain" }),
				),
			}),
		]);

		const { copied, fixed, skipped } = await encoded;
		const what = copied === selected.length ? label : `${copied} of ${selected.length} screens`;

		const notes = [
			fixed ? `${plural(fixed, "layout")} kept as fixed positions.` : "",
			skipped ? `${plural(skipped, "text")} ${skipped === 1 ? "uses" : "use"} characters that draw after an edit.` : "",
			copied < selected.length ? "The rest are over Figma's paste size; copy them separately." : "",
		];

		toast.success(`Copied ${what} to Figma`, {
			id,
			description: notes.join(" ").trim() || "Paste it into a Figma file.",
		});
	} catch (error) {
		toast.error("Couldn't copy to Figma", { id, description: error instanceof Error ? error.message : String(error) });
	}
}
