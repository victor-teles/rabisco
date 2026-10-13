import { type ComponentProps, createContext, type CSSProperties, useContext } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type ChromeBox = { x: number; y: number; width?: number; height?: number };

export const ChromeLayer = createContext<HTMLElement | null>(null);

export function chromeBox({ x, y, width = 0, height = 0 }: ChromeBox): CSSProperties {
	return {
		left: `calc(${x}px * var(--zoom))`,
		top: `calc(${y}px * var(--zoom))`,
		width: `calc(${width}px * var(--zoom))`,
		height: `calc(${height}px * var(--zoom))`,
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
