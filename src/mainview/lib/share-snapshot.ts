import { projectAssets } from "@/lib/render/assets";
import { compileCache } from "@/lib/render/compile";
import { collectGraph } from "@/lib/render/graph";
import { screenStyles, themeCss } from "@/lib/render/styles";
import type { DesignTokens } from "../../shared/context/tokens";
import { shareScreens, type ShareModule, type ShareSnapshot } from "../../shared/share/snapshot";
import type { Frame, ProjectFiles } from "../../shared/types";

/** Read-only viewer payload (decision 0008), built from the same render path as the canvas. */
export async function buildShareSnapshot(input: {
	name: string;
	frames: Frame[];
	files: ProjectFiles;
	/** The applied tokens, so the link looks like the canvas */
	theme: DesignTokens;
	start?: string;
}): Promise<ShareSnapshot> {
	const { files } = input;
	const screens = shareScreens(input.frames, files);

	if (screens.length === 0) throw new Error("There are no screens to share yet");
	// First: a new custom token name restarts the compiler
	const theme = themeCss(input.theme);
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
	const assets = await projectAssets.dataUrls();

	const snapshot: ShareSnapshot = {
		version: 1,
		name: input.name,
		createdAt: new Date().toISOString(),
		start,
		screens,
		modules,
		css: screenStyles.css,
		theme,
	};

	if (Object.keys(assets).length) snapshot.assets = assets;

	return snapshot;
}
