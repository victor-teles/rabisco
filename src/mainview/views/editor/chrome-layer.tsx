import { type ComponentProps, createContext, type CSSProperties, useContext } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type ChromeBox = { x: number; y: number; width?: number; height?: number };

export const ChromeLayer = createContext<HTMLElement | null>(null);

export const snapToPixel = (value: number, ratio = devicePixelRatio) => Math.round(value * ratio) / ratio;

export const zoomed = (px: number) => `calc(${px}px * var(--zoom))`;

export function chromeBox({ x, y, width = 0, height = 0 }: ChromeBox): CSSProperties {
	return {
		left: zoomed(x),
		top: zoomed(y),
		width: zoomed(width),
		height: zoomed(height),
	};
}

export function ChromePortal({ box, className, style, ...props }: ComponentProps<"div"> & { box: ChromeBox }) {
	const layer = useContext(ChromeLayer);

	if (!layer) return null;

	return createPortal(
		<div
			{...props}
			className={cn("pointer-events-none absolute", className)}
			style={{ ...chromeBox(box), ...style }}
		/>,
		layer,
	);
}
