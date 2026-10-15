import { referenceAttachments } from "@/hooks/use-moodboard";
import { projectAssets } from "@/lib/render/assets";
import { renderOffstage } from "@/lib/render/offstage-render";
import type { DesignTokens } from "../../shared/context/tokens";
import type { ResolvedMode } from "../../shared/modes";
import { pixelDifference, recreateDevice, sampleSize } from "../../shared/recreate";
import type { CanvasImage, Frame, ProjectFiles } from "../../shared/types";
import type { RunOptions } from "./generation-session";

export type Comparison = { screen: string; width: number; height: number; difference: number };

export async function recreateRequest(image: CanvasImage): Promise<RunOptions["recreate"] | null> {
	const blob = projectAssets.get(image.src);
	const [reference] = await referenceAttachments([image]);

	if (!blob || !reference) return null;
	const bitmap = await createImageBitmap(blob);
	const device = recreateDevice(bitmap.width, bitmap.height);
	bitmap.close();

	return { image, device, reference };
}

async function pixelsOf(source: Blob, width: number, height: number) {
	const bitmap = await createImageBitmap(source);
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext("2d", { willReadFrequently: true });

	if (!context) throw new Error("Couldn't read the image");
	context.fillStyle = "#fff";
	context.fillRect(0, 0, width, height);
	context.drawImage(bitmap, 0, 0, width, (bitmap.height * width) / Math.max(1, bitmap.width));
	bitmap.close();

	return context.getImageData(0, 0, width, height).data;
}

export async function compareWithScreenshot(
	frame: Frame,
	image: CanvasImage,
	files: ProjectFiles,
	theme: DesignTokens,
	mode: ResolvedMode,
): Promise<Comparison> {
	const blob = projectAssets.get(image.src);

	if (!blob) throw new Error("The screenshot hasn't loaded");
	const bitmap = await createImageBitmap(blob);
	const height = Math.max(1, Math.round((frame.width * bitmap.height) / Math.max(1, bitmap.width)));
	bitmap.close();

	const snapshot = await renderOffstage(frame, files, theme, mode, (host) =>
		host.snapshot({ type: "image/png", scale: Math.min(2, window.devicePixelRatio || 1), maxHeight: height }),
	);

	const screen = snapshot.raster?.dataUrl;

	if (!screen) throw new Error("Couldn't render the screen");
	const rendered = await (await fetch(screen)).blob();
	const sample = sampleSize(frame.width, height);

	const [ours, theirs] = await Promise.all([
		pixelsOf(rendered, sample.width, sample.height),
		pixelsOf(blob, sample.width, sample.height),
	]);

	return {
		screen,
		width: frame.width,
		height,
		difference: pixelDifference(ours, theirs),
	};
}
