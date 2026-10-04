import { useEffect, useRef } from "react";
import { FrameHost, runtimeUrl } from "@/lib/render/frame-host";
import type { ProjectFiles, ScreenSource } from "../../../shared/types";

/**
 * Renders the screen `entry` from `files` in a sandboxed frame running the screen runtime.
 * `allow-scripts` without `allow-same-origin` keeps generated code away from the app.
 * Non-interactive: the canvas handles pointer input. The frame re-renders only when a file
 * in the entry's module graph, or the shared CSS, changes.
 */
export function ScreenFrame({
	entry,
	files,
	width,
	height,
	className,
}: {
	entry: string;
	files: ProjectFiles;
	width: number;
	height: number;
	className?: string;
}) {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const hostRef = useRef<FrameHost | null>(null);

	useEffect(() => {
		const host = new FrameHost(frameRef.current!);
		hostRef.current = host;
		return () => {
			host.dispose();
			hostRef.current = null;
		};
	}, []);

	useEffect(() => {
		hostRef.current?.update(entry, files);
	}, [entry, files]);

	return (
		<iframe
			ref={frameRef}
			title={entry}
			src={runtimeUrl()}
			sandbox="allow-scripts"
			tabIndex={-1}
			className={className}
			style={{ width, height, border: 0, pointerEvents: "none", display: "block" }}
		/>
	);
}

/** A screen scaled down to fit inside `maxWidth` × `maxHeight`, for thumbnails. */
export function ScreenPreview({ source, maxWidth, maxHeight }: { source: ScreenSource; maxWidth: number; maxHeight: number }) {
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
