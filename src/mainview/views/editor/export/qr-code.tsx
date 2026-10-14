import { useMemo } from "react";
import { encode } from "uqr";
import { cn } from "@/lib/utils";

export type QrPath = { size: number; path: string };

export function qrPath(text: string): QrPath {
	const { size, data } = encode(text, { ecc: "M", border: 2 });
	let path = "";

	data.forEach((row, y) => {
		row.forEach((dark, x) => {
			if (dark) path += `M${x} ${y}h1v1h-1z`;
		});
	});

	return { size, path };
}

/** Dark on white in both themes: some phone cameras don't read an inverted code */
export function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
	const { size, path } = useMemo(() => qrPath(text), [text]);

	return (
		<svg
			role="img"
			aria-label={label}
			viewBox={`0 0 ${size} ${size}`}
			className={cn("rounded-md bg-white text-black ring-1 ring-border [shape-rendering:crispEdges]", className)}
		>
			<path d={path} fill="currentColor" />
		</svg>
	);
}
