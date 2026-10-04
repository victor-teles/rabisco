import { cn } from "@/lib/utils";

/** "Rabisco" is Portuguese for scribble — the mark is a single pen stroke. */
export function LogoMark({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				"grid size-7 place-items-center rounded-[9px] bg-foreground text-background",
				className,
			)}
		>
			<svg viewBox="0 0 24 24" fill="none" className="size-[18px]" aria-hidden="true">
				<path
					d="M4 15.5c2.2-5.2 4.6-8 6.2-7.4 2 .8-2.6 7.9-.6 8.6 1.7.6 3.9-6.1 6-5.6 1.8.4-.6 5.1 1 5.6 1 .3 2.1-1 3.4-2.6"
					stroke="currentColor"
					strokeWidth="2.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</span>
	);
}

export function Logo({ className }: { className?: string }) {
	return (
		<span className={cn("flex items-center gap-2", className)}>
			<LogoMark />
			<span className="text-[15px] font-semibold tracking-tight">Rabisco</span>
		</span>
	);
}
