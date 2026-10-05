import { useEffect, useEffectEvent, useRef } from "react";
import { FrameHost, runtimeUrl } from "@/lib/render/frame-host";
import type { ProjectFiles, ScreenSource } from "../../../shared/types";

/**
 * Renders the screen `entry` from `files` in a sandboxed frame running the screen runtime.
 * `allow-scripts` without `allow-same-origin` keeps generated code away from the app.
 * Non-interactive unless `interactive` (text editing in place): the canvas handles pointer input. The frame re-renders only when a file
 * in the entry's module graph, or the shared CSS, changes. `onContentHeight` receives the
 * screen's content height whenever it changes (compare mode sizes frames to it).
 * `play` turns on play mode (decision 0007): clicks on linked elements call
 * `onNavigate` with the link as written, and Escape inside the frame calls `onEscape`.
 */
export function ScreenFrame({
	entry,
	files,
	width,
	height,
	className,
	interactive = false,
	play = false,
	onContentHeight,
	onNavigate,
	onEscape,
}: {
	entry: string;
	files: ProjectFiles;
	width: number;
	height: number;
	className?: string;
	interactive?: boolean;
	play?: boolean;
	onContentHeight?: (height: number) => void;
	onNavigate?: (to: string) => void;
	onEscape?: () => void;
}) {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const hostRef = useRef<FrameHost | null>(null);
	const contentHeightChanged = useEffectEvent((contentHeight: number) => onContentHeight?.(contentHeight));
	const navigated = useEffectEvent((to: string) => onNavigate?.(to));
	const escaped = useEffectEvent(() => onEscape?.());

	useEffect(() => {
		const host = new FrameHost(frameRef.current!);
		host.onContentHeight = (contentHeight) => contentHeightChanged(contentHeight);
		host.onNavigate = (to) => navigated(to);
		host.onEscape = () => escaped();
		hostRef.current = host;

		return () => {
			host.dispose();
			hostRef.current = null;
		};
	}, []);

	useEffect(() => {
		hostRef.current?.update(entry, files);
	}, [entry, files]);

	useEffect(() => {
		hostRef.current?.setPlay(play);
	}, [play]);

	return (
		<iframe
			ref={frameRef}
			title={entry}
			src={runtimeUrl()}
			sandbox="allow-scripts"
			tabIndex={-1}
			className={className}
			style={{ width, height, border: 0, pointerEvents: interactive ? "auto" : "none", display: "block" }}
		/>
	);
}

/** A screen scaled down to fit inside `maxWidth` × `maxHeight`, for thumbnails. */
export function ScreenPreview({
	source,
	maxWidth,
	maxHeight,
}: {
	source: ScreenSource;
	maxWidth: number;
	maxHeight: number;
}) {
	const scale = Math.min(maxWidth / source.width, maxHeight / source.height);

	return (
		<div
			className="overflow-hidden rounded-md bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_4px_12px_-4px_rgb(0_0_0/0.16)]"
			style={{ width: source.width * scale, height: source.height * scale }}
		>
			<div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
				<ScreenFrame entry={source.entry} files={source.files} width={source.width} height={source.height} />
			</div>
		</div>
	);
}
