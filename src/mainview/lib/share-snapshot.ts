import { compileCache } from "@/lib/render/compile";
import { collectGraph } from "@/lib/render/graph";
import { screenStyles } from "@/lib/render/styles";
import { designThemeCss } from "@/lib/render/theme";
import { shareScreens, type ShareModule, type ShareSnapshot } from "../../shared/share/snapshot";
import type { Frame, ProjectFiles } from "../../shared/types";

/**
 * Everything the read-only viewer needs (decision 0008), built from the same
 * render path as the canvas: each screen's module graph compiled with Sucrase
 * (cached), the shared Tailwind stylesheet with every class they use, and the
 * DESIGN.md token overrides. `start` is where the viewer opens, if it is a screen.
 */
export async function buildShareSnapshot(input: {
	name: string;
	frames: Frame[];
	files: ProjectFiles;
	start?: string;
}): Promise<ShareSnapshot> {
	const { files } = input;
	const screens = shareScreens(input.frames, files);

	if (screens.length === 0) throw new Error("There are no screens to share yet");
	await screenStyles.whenReady();
	const modules: Record<string, ShareModule> = {};

	for (const screen of screens) {
		for (const [path, module] of collectGraph(screen.file, files, compileCache).modules) {
			if (modules[path]) continue;
			screenStyles.add(module.candidates);
			modules[path] = module.error
				? { source: module.source, error: module.error }
				: { source: module.source, code: module.code! };
		}
	}

	const start = screens.some((screen) => screen.file === input.start) ? input.start! : screens[0]!.file;

	return {
		version: 1,
		name: input.name,
		createdAt: new Date().toISOString(),
		start,
		screens,
		modules,
		css: screenStyles.css,
		theme: designThemeCss(files),
	};
}
