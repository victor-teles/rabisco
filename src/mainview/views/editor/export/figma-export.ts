import { toast } from "sonner";
import type { FigmaExportReply, FigmaExportScreen } from "@/lib/figma-export-worker";
import { renderOffstage } from "@/lib/render/offstage-render";
import type { DesignTokens } from "../../../../shared/context/tokens";
import { screenNameFromPath } from "../../../../shared/project";
import type { Frame, ProjectFiles } from "../../../../shared/types";

const ENCODE_TIMEOUT_MS = 60_000;

export type FigmaCopyInput = {
	selected: Frame[];
	files: ProjectFiles;
	theme: DesignTokens;
};

const nameOf = (frame: Frame) => frame.name || screenNameFromPath(frame.file);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

async function capture(frames: Frame[], files: ProjectFiles, theme: DesignTokens) {
	const left = Math.min(...frames.map((frame) => frame.x));
	const top = Math.min(...frames.map((frame) => frame.y));
	const screens: FigmaExportScreen[] = [];

	for (const frame of frames) {
		const { tree, images } = await renderOffstage(frame, files, theme, (host) => host.figmaCapture());

		screens.push({ name: nameOf(frame), x: frame.x - left, y: frame.y - top, tree, images });
	}

	return screens;
}

function encode(screens: FigmaExportScreen[]): Promise<{ html: string; copied: number; fixed: number }> {
	const worker = new Worker(new URL("../../../lib/figma-export-worker.ts", import.meta.url), { type: "module" });

	return new Promise<{ html: string; copied: number; fixed: number }>((resolve, reject) => {
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
		worker.postMessage(screens);
	}).finally(() => worker.terminate());
}

export async function copyToFigma({ selected, files, theme }: FigmaCopyInput) {
	if (!selected.length) {
		toast("Select a screen to copy it to Figma");

		return;
	}

	const label = selected.length === 1 ? nameOf(selected[0]!) : plural(selected.length, "screen");
	const id = toast.loading(`Copying ${label} to Figma…`);
	const encoded = capture(selected, files, theme).then(encode);

	try {
		await navigator.clipboard.write([
			new ClipboardItem({
				"text/html": encoded.then(({ html }) => new Blob([html], { type: "text/html" })),
				"text/plain": encoded.then(
					({ copied }) => new Blob([selected.slice(0, copied).map(nameOf).join("\n")], { type: "text/plain" }),
				),
			}),
		]);

		const { copied, fixed } = await encoded;
		const what = copied === selected.length ? label : `${copied} of ${selected.length} screens`;

		const notes = [
			fixed ? `${plural(fixed, "layout")} kept as fixed positions.` : "",
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
