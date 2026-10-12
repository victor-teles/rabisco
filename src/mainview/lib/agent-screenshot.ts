import { renderOffstage } from "@/lib/render/offstage-render";
import { sourceVersion, type Box } from "@/lib/render/protocol";
import type { DesignTokens } from "../../shared/context/tokens";
import type { Frame, ProjectFiles } from "../../shared/types";

export const MAX_SCREENSHOT_WIDTH = 1280;

/** Element shots are sharper than screen shots, as long as the rendered page stays a sane size */
const MAX_ELEMENT_SCALE = 2;

const MAX_RASTER_PIXELS = 16_000_000;

/** Device pixels per CSS pixel for a crop of `width` × `bottom` CSS pixels from the top */
export function screenshotScale(width: number, bottom: number, cropWidth: number, preferred: number) {
	const byWidth = MAX_SCREENSHOT_WIDTH / Math.max(1, cropWidth);
	const byArea = Math.sqrt(MAX_RASTER_PIXELS / Math.max(1, width * bottom));

	return Math.min(preferred, byWidth, byArea);
}

const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

async function crop(dataUrl: string, box: Box, scale: number): Promise<string> {
	const image = new Image();
	image.src = dataUrl;
	await image.decode();
	const x = Math.max(0, Math.floor(box.x * scale));
	const y = Math.max(0, Math.floor(box.y * scale));
	const width = Math.max(1, Math.min(image.naturalWidth - x, Math.ceil(box.width * scale)));
	const height = Math.max(1, Math.min(image.naturalHeight - y, Math.ceil(box.height * scale)));
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	canvas.getContext("2d")?.drawImage(image, x, y, width, height, 0, 0, width, height);

	return canvas.toDataURL("image/png");
}

/** Rendered offstage like the design check, so it works for screens off the viewport */
export function agentScreenshot(files: ProjectFiles, theme: DesignTokens) {
	return (frame: Frame, start: number | null) =>
		renderOffstage(frame, files, theme, async (host) => {
			if (start === null) {
				const height = (await host.measure()) ?? frame.height;
				const scale = screenshotScale(frame.width, height, frame.width, 1);
				const shot = await host.snapshot({ type: "image/png", scale });

				if (!shot.raster) throw new Error("The screen didn't render an image");

				return base64Of(shot.raster.dataUrl);
			}

			const [box] = (await host.elementBoxes(start, sourceVersion(files[frame.file] ?? ""))) ?? [];

			if (!box || box.width <= 0 || box.height <= 0) throw new Error("The element isn't visible on the screen");
			const bottom = box.y + box.height;
			const scale = screenshotScale(frame.width, bottom, box.width, MAX_ELEMENT_SCALE);
			const shot = await host.snapshot({ type: "image/png", scale, maxHeight: Math.ceil(bottom) });

			if (!shot.raster) throw new Error("The screen didn't render an image");

			return base64Of(await crop(shot.raster.dataUrl, box, shot.raster.scale));
		});
}
