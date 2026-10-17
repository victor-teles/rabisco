import { projectAssets } from "@/lib/render/assets";
import { compileCache } from "@/lib/render/compile";
import { collectGraph } from "@/lib/render/graph";
import { shippedFonts, usesShippedFont } from "@/lib/render/shipped-fonts";
import { screenStyles, themeCss } from "@/lib/render/styles";
import type { DesignTokens } from "../../shared/context/tokens";
import { motionDefaults } from "../../shared/prototype/transitions";
import { elementSpans } from "../../shared/share/spans";
import { shareScreens, type ShareModule, type ShareSnapshot } from "../../shared/share/snapshot";
import type { CanvasSection, Frame, ProjectFiles } from "../../shared/types";

/** Read-only viewer payload (decision 0008), built from the same render path as the canvas. */
export async function buildShareSnapshot(input: {
	name: string;
	frames: Frame[];
	sections: readonly CanvasSection[];
	files: ProjectFiles;
	/** The applied tokens, so the link looks like the canvas */
	theme: DesignTokens;
	start?: string;
	drafts?: boolean;
}): Promise<ShareSnapshot> {
	const { files } = input;
	const screens = shareScreens(input.frames, files, input.sections, input.theme, input.drafts);

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
				: { source: module.source, code: module.code!, icons: module.icons, elements: elementSpans(module.source) };
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
	const motion = motionDefaults(input.theme);

	if (Object.keys(motion).length) snapshot.motion = motion;

	const fonts = usesShippedFont(`${snapshot.css}\n${theme}`) ? await shippedFonts.dataUrls() : [];

	if (fonts.length) snapshot.fonts = fonts;

	return snapshot;
}
