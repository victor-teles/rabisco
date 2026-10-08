import { Check, LoaderCircle, Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TokenChange } from "../../../shared/context/theme";
import { COLOR_TOKENS } from "../../../shared/context/tokens";

export type ThemeBarState =
	/** DESIGN.md lists tokens that differ from the applied ones */
	| { kind: "tokens"; count: number }
	/** DESIGN.md changed and lists no tokens: reading it takes AI */
	| { kind: "read"; hasModel: boolean; busyReason?: string }
	| { kind: "reading" }
	| { kind: "applied"; changes: TokenChange[] };

const SWATCHES = 6;

const colorNames = new Set<string>(COLOR_TOKENS);

/** Asks before DESIGN.md re-themes the screens; they keep the applied theme until then */
export function ThemePrompt({
	state,
	className,
	onApply,
	onRead,
	onDismiss,
	onReview,
	onStop,
	onUndo,
	onOpenSettings,
}: {
	state: ThemeBarState;
	className?: string;
	onApply: () => void;
	onRead: () => void;
	onDismiss: () => void;
	onReview: () => void;
	onStop: () => void;
	onUndo: () => void;
	onOpenSettings: () => void;
}) {
	const review = (label: string, detail?: string) => (
		<button
			type="button"
			onClick={onReview}
			className="ml-1 rounded-sm whitespace-nowrap hover:underline"
			title="Show DESIGN.md"
		>
			{label}
			{detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
		</button>
	);

	const notNow = (
		<Button variant="ghost" size="xs" className="ml-2 text-muted-foreground" onClick={onDismiss}>
			Not now
		</Button>
	);

	return (
		<div
			role="status"
			className={cn(
				"flex items-center gap-1 rounded-xl border bg-popover py-1 pr-1 pl-3 text-[13px] shadow-[0_8px_24px_-8px_rgb(0_0_0/0.18)]",
				className,
			)}
		>
			{state.kind === "reading" ? (
				<>
					<LoaderCircle className="size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin" aria-hidden />
					<span className="ml-1 whitespace-nowrap">Reading the theme from DESIGN.md…</span>
					<Button variant="ghost" size="xs" className="ml-2 text-muted-foreground" onClick={onStop}>
						Stop
					</Button>
				</>
			) : state.kind === "applied" ? (
				<Applied changes={state.changes} onUndo={onUndo} onClose={onDismiss} />
			) : (
				<>
					<Palette className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
					{state.kind === "tokens" ? (
						<>
							{review("DESIGN.md tokens changed", `${state.count} ${state.count === 1 ? "token" : "tokens"}`)}
							{notNow}
							<Button size="xs" onClick={onApply}>
								Apply to screens
							</Button>
						</>
					) : state.hasModel ? (
						<>
							{review("DESIGN.md changed")}
							{notNow}
							<Button size="xs" onClick={onRead} disabled={Boolean(state.busyReason)} title={state.busyReason}>
								Update theme
							</Button>
						</>
					) : (
						<>
							{review("DESIGN.md changed", "set up an AI provider to read its theme")}
							{notNow}
							<Button size="xs" onClick={onOpenSettings}>
								Open Settings
							</Button>
						</>
					)}
				</>
			)}
		</div>
	);
}

function Applied({ changes, onUndo, onClose }: { changes: TokenChange[]; onUndo: () => void; onClose: () => void }) {
	const swatches = changes.filter((change) => colorNames.has(change.name) && change.value).slice(0, SWATCHES);
	const count = changes.length;

	return (
		<>
			<Check className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
			<span className="ml-1 whitespace-nowrap">
				{count ? "Theme updated" : "Theme already matches DESIGN.md"}
				{count ? (
					<span className="text-muted-foreground">
						{" "}
						· {count} {count === 1 ? "token" : "tokens"}
					</span>
				) : null}
			</span>
			{swatches.length ? (
				<span className="ml-2 flex items-center gap-1" aria-label="Changed colors">
					{swatches.map((change) => (
						<span
							key={`${change.dark ? "dark" : "light"}:${change.name}`}
							className="size-3.5 rounded-[4px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
							style={{ background: change.value }}
							title={`${change.name}${change.dark ? " (dark)" : ""}: ${change.value}`}
							role="img"
							aria-label={`${change.name}${change.dark ? " (dark)" : ""}: ${change.value}`}
						/>
					))}
				</span>
			) : null}
			{count ? (
				<Button variant="ghost" size="xs" className="ml-2" onClick={onUndo}>
					Undo
				</Button>
			) : null}
			<Button variant="ghost" size="icon-xs" className="text-muted-foreground" onClick={onClose} aria-label="Close">
				<X />
			</Button>
		</>
	);
}
