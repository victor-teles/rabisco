let layer: HTMLDivElement | null = null;

/**
 * Where hidden render frames (snapshots, image export) go. They take a screen's full size, so a tall
 * screen would make the page taller than the window, and `scrollIntoView` or a focus would then scroll
 * the whole editor up. The layer covers the window and clips them; they stay inside the viewport,
 * since browsers throttle offscreen cross-origin frames.
 */
export function offstage(): HTMLDivElement {
	if (layer?.isConnected) return layer;

	layer = document.createElement("div");
	layer.setAttribute("aria-hidden", "true");
	layer.style.cssText = "position:fixed;inset:0;overflow:hidden;opacity:0;pointer-events:none;z-index:-1";
	document.body.appendChild(layer);

	return layer;
}

/** Inline style for a frame placed in `offstage()` */
export const OFFSTAGE_FRAME_STYLE = "position:absolute;left:0;top:0;border:0";
