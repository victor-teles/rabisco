import { Ban, ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
	AUTO_STYLE,
	isStyleId,
	STYLES,
	styleById,
	type DesignStyle,
	type StyleChoice,
	type StyleId,
} from "../../../shared/context/styles";

const NONE = "none";

/** The style's own colors: they preview the design, so they don't follow the app theme */
function StyleSwatch({ style, className }: { style: DesignStyle; className?: string }) {
	const { background, border, primary } = style.light;
	const extra = style.light["color-brand"] ?? style.light["color-pop"] ?? style.light.accent;

	return (
		<span
			aria-hidden
			className={cn("flex shrink-0 items-center justify-center gap-0.5 rounded-sm border", className)}
			style={{ background, borderColor: border }}
		>
			<span className="size-2 rounded-full" style={{ background: primary }} />
			<span className="size-2 rounded-full" style={{ background: extra }} />
		</span>
	);
}

/** Swatch, name in the style's font and one line; the same in the Home picker, the empty chat and the dialog */
function StyleOption({ style }: { style: DesignStyle }) {
	return (
		<>
			<StyleSwatch style={style} className="h-7 w-9" />
			<span className="flex min-w-0 flex-col">
				<span className="text-[13px]" style={{ fontFamily: style.sampleFont }}>
					{style.label}
				</span>
				<span className="truncate text-xs text-muted-foreground">{style.description}</span>
			</span>
		</>
	);
}

/** The styles as buttons, for a project that already exists and has no DESIGN.md direction */
export function StyleChoices({ onPick, className }: { onPick: (id: StyleId) => void; className?: string }) {
	return (
		<div className={cn("grid gap-0.5", className)}>
			{STYLES.map((style) => (
				<button
					key={style.id}
					type="button"
					onClick={() => onPick(style.id)}
					className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					<StyleOption style={style} />
				</button>
			))}
		</div>
	);
}

const choiceOf = (value: string): StyleChoice => (value === AUTO_STYLE ? AUTO_STYLE : isStyleId(value) ? value : null);

/** The starting DESIGN.md of a new project: a preset, Auto (written from the prompt), or `null` for the template */
export function StylePicker({
	value,
	onChange,
	className,
}: {
	value: StyleChoice;
	onChange: (value: StyleChoice) => void;
	className?: string;
}) {
	const auto = value === AUTO_STYLE;
	const current = value && value !== AUTO_STYLE ? styleById(value) : null;
	const label = auto ? "Auto" : (current?.label ?? "No style");

	return (
		<DropdownMenu modal={false}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="xs"
							aria-label={`Style: ${auto ? "Auto" : (current?.label ?? "None")}`}
							className={cn("h-7 gap-1.5 px-1.5 text-muted-foreground", className)}
						>
							{current ? (
								<StyleSwatch style={current} className="h-4 w-6" />
							) : auto ? (
								<Sparkles className="size-3.5" />
							) : (
								<Ban className="size-3.5" />
							)}
							<span className="text-xs">{label}</span>
							<ChevronDown className="size-3 shrink-0" />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">Starting style</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start" side="top" className="w-76">
				<DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
					Starts DESIGN.md with tokens and rules
				</DropdownMenuLabel>
				<DropdownMenuRadioGroup value={value ?? NONE} onValueChange={(next) => onChange(choiceOf(next))}>
					{STYLES.map((style) => (
						<DropdownMenuRadioItem key={style.id} value={style.id} className="gap-2.5 py-1.5">
							<StyleOption style={style} />
						</DropdownMenuRadioItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuRadioItem value={AUTO_STYLE} className="gap-2.5 py-1.5">
						<span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-sm border">
							<Sparkles className="size-3.5 text-muted-foreground" />
						</span>
						<span className="flex min-w-0 flex-col">
							<span className="text-[13px]">Auto</span>
							<span className="truncate text-xs text-muted-foreground">From your prompt, before the screens</span>
						</span>
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value={NONE} className="gap-2.5 py-1.5">
						<span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-sm border border-dashed">
							<Ban className="size-3.5 text-muted-foreground" />
						</span>
						<span className="flex min-w-0 flex-col">
							<span className="text-[13px]">No style</span>
							<span className="truncate text-xs text-muted-foreground">Write DESIGN.md yourself later</span>
						</span>
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
