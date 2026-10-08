import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const SAMPLE_MS = 500;

/** Main-thread frame rate and the slowest frame of each sample. Writes to the DOM, so it never re-renders */
export function FpsMeter({ className }: { className?: string }) {
	const output = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		let raf = 0;
		let start = performance.now();
		let last = start;
		let frames = 0;
		let slowest = 0;

		const tick = (now: number) => {
			frames++;
			slowest = Math.max(slowest, now - last);
			last = now;

			if (now - start >= SAMPLE_MS && output.current) {
				const fps = Math.round((frames * 1000) / (now - start));
				output.current.textContent = `${fps} fps · ${slowest.toFixed(1)} ms max`;
				// Two frames' budget at 60 Hz: a hitch anyone notices
				output.current.dataset.slow = String(slowest > 33);
				start = now;
				frames = 0;
				slowest = 0;
			}

			raf = requestAnimationFrame(tick);
		};

		raf = requestAnimationFrame(tick);

		return () => cancelAnimationFrame(raf);
	}, []);

	return (
		<span
			ref={output}
			aria-hidden="true"
			className={cn(
				"pointer-events-none rounded-md border bg-popover/90 px-2 py-1 font-mono text-[11px]/4 text-muted-foreground tabular-nums shadow-sm data-[slow=true]:text-destructive",
				className,
			)}
		>
			– fps
		</span>
	);
}
