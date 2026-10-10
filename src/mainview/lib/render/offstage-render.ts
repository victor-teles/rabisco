import type { DesignTokens } from "../../../shared/context/tokens";
import type { Frame, ProjectFiles } from "../../../shared/types";
import { FrameHost, runtimeUrl } from "./frame-host";
import { OFFSTAGE_FRAME_STYLE, offstage } from "./offstage";
import { themeCss } from "./styles";

/** Passes to grow a screen whose content grows with it (e.g. `min-h-screen`) */
const GROW_PASSES = 3;

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Renders a screen at its full content height in a hidden frame, hands its host to `use`, then removes it */
export async function renderOffstage<T>(
	frame: Frame,
	files: ProjectFiles,
	theme: DesignTokens,
	use: (host: FrameHost) => Promise<T>,
): Promise<T> {
	const iframe = document.createElement("iframe");
	iframe.sandbox.add("allow-scripts");
	iframe.title = `Render ${frame.file}`;
	iframe.tabIndex = -1;
	iframe.setAttribute("aria-hidden", "true");
	iframe.style.cssText = OFFSTAGE_FRAME_STYLE;
	iframe.style.width = `${frame.width}px`;
	iframe.style.height = `${frame.height}px`;
	const host = new FrameHost(iframe);

	try {
		iframe.src = runtimeUrl();
		offstage().appendChild(iframe);
		host.update(frame.file, files, themeCss(theme));
		await host.whenRendered();
		let height = frame.height;

		for (let pass = 0; pass < GROW_PASSES; pass++) {
			const content = await host.measure();

			if (!content || content <= height) break;
			height = content;
			iframe.style.height = `${height}px`;
			await nextFrame();
		}

		return await use(host);
	} finally {
		host.dispose();
		iframe.remove();
	}
}
