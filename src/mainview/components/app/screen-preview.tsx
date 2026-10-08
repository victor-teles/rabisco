import {
	createContext,
	useContext,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { FrameHost, onFrameStatus, runtimeUrl } from "@/lib/render/frame-host";
import {
	cachedSnapshot,
	captureLive,
	renderSnapshot,
	snapshotFailed,
	snapshotKey,
	subscribeSnapshots,
} from "@/lib/render/snapshots";
import { themeCss } from "@/lib/render/theme";
import type { ProjectFiles, ScreenSource } from "../../../shared/types";

/** CSS of the project's applied tokens; every frame below renders with it */
export const ScreenTheme = createContext("");

/** Absorbs `live` flapping (hover, gesture ends) before the iframe goes. */
const UNMOUNT_DELAY_MS = 400;

/** How long an unmounting frame waits for its snapshot. */
const UNMOUNT_CAPTURE_MS = 2_000;

/** After the last render, before a live frame's snapshot is taken. */
const SETTLE_MS = 1_500;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function decoded(url: string | undefined) {
	if (!url) return;
	const image = new Image();
	image.src = url;
	await image.decode().catch(() => {});
}

/**
 * `allow-scripts` without `allow-same-origin` keeps generated code away from the app.
 *
 * Passing `live` (even `true`) opts into snapshots: when it's `false` the iframe unmounts and a cached image of the
 * screen shows instead, captured from the live frame or rendered in a shared hidden frame. Without a snapshot yet,
 * a white box shows. Snapshots stay up until a remounted frame has rendered.
 */
export function ScreenFrame({
	entry,
	files,
	width,
	height,
	className,
	interactive = false,
	play = false,
	live,
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
	live?: boolean;
	onContentHeight?: (height: number) => void;
	onNavigate?: (to: string) => void;
	onEscape?: () => void;
}) {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const hostRef = useRef<FrameHost | null>(null);
	const contentHeightChanged = useEffectEvent((contentHeight: number) => onContentHeight?.(contentHeight));
	const navigated = useEffectEvent((to: string) => onNavigate?.(to));
	const escaped = useEffectEvent(() => onEscape?.());
	const theme = useContext(ScreenTheme);
	const virtual = live !== undefined;
	const isLive = live ?? true;
	const [mounted, setMounted] = useState(isLive);

	if (isLive && !mounted) setMounted(true);
	const [painted, setPainted] = useState(false);

	const key = useMemo(
		() => (virtual ? snapshotKey(entry, files, theme, width, height) : ""),
		[virtual, entry, files, theme, width, height],
	);

	const cached = useSyncExternalStore(subscribeSnapshots, () => (key ? cachedSnapshot(key) : undefined));
	const [last, setLast] = useState<string | undefined>(undefined);
	// A stale image beats a white box while the current one is captured
	const snapshot = cached ?? last;

	if (cached && cached !== last) setLast(cached);
	const lastSnapshot = useEffectEvent(() => last);

	const isCurrent = useEffectEvent((host: FrameHost, captured: string) => hostRef.current === host && key === captured);
	const isWanted = useEffectEvent((captured: string) => !isLive && key === captured);

	useEffect(() => {
		if (!mounted) return;
		const host = new FrameHost(frameRef.current!);
		host.onContentHeight = (contentHeight) => contentHeightChanged(contentHeight);
		host.onNavigate = (to) => navigated(to);
		host.onEscape = () => escaped();
		hostRef.current = host;

		const unsubscribe = onFrameStatus((status) => {
			if (status.frame === host.frame && (status.status === "rendered" || status.status === "error")) setPainted(true);
		});

		const visibility = new IntersectionObserver(([change]) => host.setPaused(!change?.isIntersecting));
		visibility.observe(wrapperRef.current!);

		return () => {
			visibility.disconnect();
			unsubscribe();
			host.dispose();
			hostRef.current = null;
			setPainted(false);
		};
	}, [mounted]);

	useEffect(() => {
		hostRef.current?.update(entry, files, theme);
	}, [entry, files, theme, mounted]);

	useEffect(() => {
		hostRef.current?.setPlay(play);
	}, [play, mounted]);

	useEffect(() => {
		if (isLive || !mounted) return;
		let cancelled = false;

		void (async () => {
			await wait(UNMOUNT_DELAY_MS);
			const host = hostRef.current;

			if (cancelled) return;

			if (host && !cachedSnapshot(key))
				await Promise.race([captureLive(host, key, height, true, () => !cancelled), wait(UNMOUNT_CAPTURE_MS)]);
			await decoded(cachedSnapshot(key) ?? lastSnapshot());

			if (!cancelled) setMounted(false);
		})();

		return () => void (cancelled = true);
	}, [isLive, mounted, key, height]);

	// Keeps the snapshot of a live frame fresh, so it can unmount at once
	useEffect(() => {
		if (!virtual || !isLive || !mounted || !painted || interactive || play || cached) return;
		const host = hostRef.current;

		if (!host) return;
		const timer = setTimeout(() => void captureLive(host, key, height, false, () => isCurrent(host, key)), SETTLE_MS);

		return () => clearTimeout(timer);
	}, [virtual, isLive, mounted, painted, interactive, play, cached, key, height]);

	useEffect(() => {
		if (!virtual || isLive || mounted || cached || snapshotFailed(key)) return;
		void renderSnapshot({ key, entry, files, theme, width, height }, () => isWanted(key));
	}, [virtual, isLive, mounted, cached, key, entry, files, theme, width, height]);

	// A frame that has painted is current: only an image of the same version may cover it
	const cover = mounted && painted ? (isLive ? undefined : cached) : snapshot;

	return (
		<div ref={wrapperRef} className={className} style={{ position: "relative", width, height }}>
			{mounted ? (
				<iframe
					ref={frameRef}
					title={entry}
					src={runtimeUrl()}
					sandbox="allow-scripts"
					tabIndex={-1}
					style={{ width, height, border: 0, pointerEvents: interactive ? "auto" : "none", display: "block" }}
				/>
			) : null}
			{cover ? (
				<img
					src={cover}
					alt=""
					draggable={false}
					className="pointer-events-none absolute inset-0 select-none"
					style={{ width, height, objectFit: "cover", objectPosition: "top" }}
				/>
			) : !mounted ? (
				<div className="pointer-events-none absolute inset-0 bg-white" />
			) : null}
		</div>
	);
}

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
				<ScreenTheme value={themeCss(source.theme)}>
					<ScreenFrame entry={source.entry} files={source.files} width={source.width} height={source.height} />
				</ScreenTheme>
			</div>
		</div>
	);
}
