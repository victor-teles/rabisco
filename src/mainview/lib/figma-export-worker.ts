import { figmaClipboard } from "../../shared/export/figma/clipboard";
import type { FigmaImage, FigmaScreen } from "../../shared/export/figma/to-figma";
import { parseCapturedTree } from "../../shared/import/captured-tree";
import type { FrameImage } from "./render/protocol";

export type FigmaExportScreen = {
	name: string;
	x: number;
	y: number;
	tree: string;
	images: Record<string, FrameImage>;
};

export type FigmaExportReply = { html: string; copied: number; fixed: number } | { error: string };

async function hashed(images: Record<string, FrameImage>) {
	const entries = await Promise.all(
		Object.entries(images).map(async ([key, image]): Promise<[string, FigmaImage]> => {
			const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", image.bytes.slice()));

			return [key, { ...image, hash }];
		}),
	);

	return new Map(entries);
}

addEventListener("message", async (event: MessageEvent<FigmaExportScreen[]>) => {
	try {
		const screens: FigmaScreen[] = [];

		for (const { name, x, y, tree: json, images } of event.data) {
			const tree = parseCapturedTree(json);

			if (tree) screens.push({ name, x, y, tree, images: await hashed(images) });
		}

		if (!screens.length) throw new Error("The screens didn't render");
		const reply: FigmaExportReply = figmaClipboard(screens);

		postMessage(reply);
	} catch (error) {
		const reply: FigmaExportReply = { error: error instanceof Error ? error.message : String(error) };

		postMessage(reply);
	}
});
