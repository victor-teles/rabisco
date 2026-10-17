// The catalog's previews are small screens that play a preset in a loop, in sandboxed frames like component
// previews (decision 0027). No pointer reaches a preview frame, so `hover:` and `active:` become `data-[on]:`,
// which the preview switches on a timer.

import { parseClass, splitClasses } from "../tailwind/classes";
import { presetClasses, type MotionPreset } from "./presets";

export const motionPreviewPath = (id: string) => `preview/motion-${id}.tsx`;

const STATE_VARIANTS = new Set(["hover", "active"]);

/** `motion-safe:hover:scale-105` → `motion-safe:data-[on]:scale-105` */
export function demoClasses(preset: MotionPreset): string {
	return splitClasses(presetClasses(preset))
		.map((raw) => {
			const parsed = parseClass(raw);

			if (!parsed.variants.some((variant) => STATE_VARIANTS.has(variant))) return raw;
			const variants = parsed.variants.map((variant) => (STATE_VARIANTS.has(variant) ? "data-[on]" : variant));

			return `${variants.join(":")}:${raw.slice(raw.lastIndexOf(":") + 1)}`;
		})
		.join(" ");
}

// Shown at half size, so snapshots, which are half resolution, stay sharp
const SAMPLE = "flex h-28 w-40 flex-col justify-end gap-3 rounded-2xl border bg-card p-5 shadow-xs";

const LINES = `<span className="h-3 w-20 rounded-full bg-primary" />
				<span className="h-3 w-14 rounded-full bg-muted-foreground/30" />`;

/** Hover and press switch every `PERIOD`, appear plays again, exit closes and opens */
const PERIOD: Record<MotionPreset["kind"], number> = { hover: 900, press: 700, appear: 1800, loop: 0, exit: 1400 };

export function motionPreviewModule(preset: MotionPreset): string {
	const classes = `${SAMPLE} ${demoClasses(preset)}${preset.kind === "exit" ? " data-[state=closed]:fill-mode-forwards" : ""}`;
	const period = PERIOD[preset.kind];

	const attributes =
		preset.kind === "appear"
			? " key={round}"
			: preset.kind === "exit"
				? ' data-state={round % 2 ? "closed" : "open"}'
				: preset.kind === "loop"
					? ""
					: ' data-on={round % 2 ? "" : undefined}';

	const timer = period
		? `
	const [round, setRound] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => setRound((value) => value + 1), ${period});

		return () => clearInterval(timer);
	}, []);
`
		: "";

	return `${period ? 'import { useEffect, useState } from "react";\n\n' : ""}export default function MotionPreview() {${timer}
	return (
		<div className="flex min-h-screen items-center justify-center bg-background">
			<div${attributes} className="${classes}">
				${LINES}
			</div>
		</div>
	);
}
`;
}
