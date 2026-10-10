import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hostOf, type FrameHost } from "@/lib/render/frame-host";
import { isTyping } from "./shortcuts";

export const EYEDROPPER_KEYS = "I";

type FramePoint = { host: FrameHost; x: number; y: number };

const BLANK = "rgb(255, 255, 255)";

function frameUnder(clientX: number, clientY: number, ignore: Element | null): FramePoint | null {
	const top = document.elementsFromPoint(clientX, clientY).find((element) => !ignore?.contains(element));

	if (!top) return null;

	for (const frame of document.querySelectorAll("iframe")) {
		const rect = frame.getBoundingClientRect();
		const inside = clientX >= rect.left && clientX < rect.right && clientY >= rect.top && clientY < rect.bottom;
		const reachable = top.contains(frame) || !!frame.closest("[data-canvas]")?.contains(top);
		const host = inside && reachable ? hostOf(frame) : undefined;

		if (!host || !rect.width || !rect.height) continue;

		return {
			host,
			x: ((clientX - rect.left) * frame.clientWidth) / rect.width,
			y: ((clientY - rect.top) * frame.clientHeight) / rect.height,
		};
	}

	return null;
}

async function sample(clientX: number, clientY: number, ignore: Element | null) {
	const point = frameUnder(clientX, clientY, ignore);

	if (!point) return null;

	return (await point.host.colorAt(point.x, point.y)) ?? BLANK;
}

type Sampled = { x: number; y: number; css: string | null };

export function EyedropperShortcut({ disabled, onStart }: { disabled?: boolean; onStart: () => void }) {
	const start = useRef(onStart);

	useEffect(() => {
		start.current = onStart;
	});

	useEffect(() => {
		if (disabled) return;

		const onKeyDown = (event: KeyboardEvent) => {
			const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

			if (!plain || event.repeat || event.defaultPrevented || event.code !== "KeyI" || isTyping(event.target)) return;
			event.preventDefault();
			start.current();
		};

		window.addEventListener("keydown", onKeyDown);

		return () => window.removeEventListener("keydown", onKeyDown);
	}, [disabled]);

	return null;
}

export function Eyedropper({
	label,
	snap,
	onPick,
	onClose,
}: {
	label: string;
	snap: (css: string) => string | null;
	onPick: (value: string) => void;
	onClose: () => void;
}) {
	const overlay = useRef<HTMLDivElement>(null);
	const pointer = useRef<{ x: number; y: number } | null>(null);
	const busy = useRef(false);
	const [sampled, setSampled] = useState<Sampled | null>(null);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			onClose();
		};

		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("blur", onClose);

		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("blur", onClose);
		};
	}, [onClose]);

	const probe = async () => {
		const at = pointer.current;

		if (busy.current || !at) return;
		busy.current = true;
		const css = await sample(at.x, at.y, overlay.current);
		busy.current = false;
		setSampled({ ...at, css });

		if (pointer.current !== at) void probe();
	};

	const value = sampled?.css ? snap(sampled.css) : null;

	return createPortal(
		<div
			ref={overlay}
			role="presentation"
			className="fixed inset-0 z-[100] cursor-crosshair"
			onPointerMove={(event) => {
				pointer.current = { x: event.clientX, y: event.clientY };
				void probe();
			}}
			onPointerDown={async (event) => {
				event.preventDefault();
				event.stopPropagation();

				if (event.button !== 0) return onClose();
				const css = await sample(event.clientX, event.clientY, overlay.current);
				const picked = css === null ? null : snap(css);

				if (picked !== null) onPick(picked);
				onClose();
			}}
			onContextMenu={(event) => event.preventDefault()}
		>
			{sampled ? (
				<div
					className="pointer-events-none absolute flex items-center gap-2 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
					style={{ left: sampled.x + 14, top: sampled.y + 14 }}
				>
					<span
						className="size-4 shrink-0 rounded-[4px] border border-black/10 dark:border-white/15"
						style={{ background: sampled.css ?? undefined }}
					/>
					<span className="font-mono">{value ?? "Pick from a screen"}</span>
					<span className="text-subtle-foreground">{label}</span>
				</div>
			) : null}
		</div>,
		document.body,
	);
}
