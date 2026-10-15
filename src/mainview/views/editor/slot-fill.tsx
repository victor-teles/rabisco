import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SlotElement, SlotFill } from "../../../shared/components/slots";

const MAX_CHIPS = 3;

/** A slot filled with elements or code: element chips select them, the eraser empties the slot */
export function SlotContent({
	slot,
	fill,
	disabled,
	onSelect,
	onClear,
}: {
	slot: string;
	fill: Extract<SlotFill, { kind: "elements" | "code" }>;
	disabled?: boolean;
	onSelect?: (element: SlotElement) => void;
	onClear: () => void;
}) {
	const shown = fill.kind === "elements" ? fill.elements.slice(0, MAX_CHIPS) : [];
	const more = fill.kind === "elements" ? fill.elements.length - shown.length : 0;

	return (
		<div className="flex min-w-0 flex-1 items-center gap-1">
			{fill.kind === "code" ? (
				<span
					title={`{${fill.text}}`}
					className="min-w-0 flex-1 truncate font-mono text-[11px] text-subtle-foreground"
				>{`{${fill.text}}`}</span>
			) : (
				<div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
					{shown.map((element) => (
						<button
							key={element.start}
							type="button"
							disabled={!onSelect}
							title={onSelect ? `Select <${element.name}>` : undefined}
							onClick={() => onSelect?.(element)}
							className="h-6 max-w-full min-w-0 shrink truncate rounded-md border px-1.5 font-mono text-[11px] text-muted-foreground transition-colors enabled:hover:bg-accent enabled:hover:text-accent-foreground"
						>
							{`<${element.name}>`}
						</button>
					))}
					{more ? <span className="shrink-0 text-[11px] text-subtle-foreground tabular-nums">+{more}</span> : null}
				</div>
			)}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon-xs"
						className="shrink-0 text-muted-foreground"
						aria-label={`Empty ${slot}`}
						disabled={disabled}
						onClick={onClear}
					>
						<Eraser />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="left">Empty {slot}</TooltipContent>
			</Tooltip>
		</div>
	);
}
