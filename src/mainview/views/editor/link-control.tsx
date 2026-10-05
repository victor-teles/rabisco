import { ChevronDown, CircleAlert, CornerUpLeft, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { findElement, parseJsx } from "../../../shared/jsx";
import { isScreenFile, screenNameFromPath } from "../../../shared/project";
import { BACK, hasExpressionLink, linkOfElement, resolveLink, type ElementRef } from "../../../shared/prototype/links";
import type { Frame, ProjectFiles } from "../../../shared/types";

export type LinkControlProps = {
	files: ProjectFiles;
	/** The canvas frames: the screens a link can go to, with their names */
	frames: Frame[];
	/** The selected element; nothing renders without one */
	element: ElementRef | null;
	/**
	 * Link the element to a screen path or `"back"`, or remove its link (`null`).
	 * Write it as one undo step, e.g. `structure.setProp(element, LINK_ATTRIBUTE, to)`.
	 */
	onChange: (element: ElementRef, to: string | null) => void;
	/** A generation is running: read-only */
	disabled?: boolean;
};

/** The radio value of "no link" */
const NONE = "";

/**
 * Design tab, "Prototype": where the selected element goes in play mode
 * (decision 0007). A dropdown of none, the project's screens and Back, written
 * as the element's `data-link-to`. A link to a screen that is gone shows as
 * missing; a link written as code is shown read-only.
 */
export function LinkControl({ files, frames, element, onChange, disabled }: LinkControlProps) {
	const source = element ? files[element.file] : undefined;
	const node = element && source !== undefined ? findElement(parseJsx(source), element.start) : null;

	if (!element || !node || node.name === null) return null;

	const written = linkOfElement(node);
	const target = written === null ? null : resolveLink(written, files);
	const value = !target ? NONE : target.kind === "screen" ? target.file : target.kind === "back" ? BACK : written!;

	const screens = frames.filter(
		(frame) => isScreenFile(frame.file) && files[frame.file] !== undefined && frame.file !== element.file,
	);

	const nameOf = (file: string) => frames.find((frame) => frame.file === file)?.name || screenNameFromPath(file);

	const label = !target
		? "None"
		: target.kind === "screen"
			? nameOf(target.file)
			: target.kind === "back"
				? "Back"
				: `Missing: ${target.to}`;

	const code = hasExpressionLink(node);

	return (
		<section className="flex flex-col gap-2 border-b p-4">
			<h3 className="text-xs font-medium text-subtle-foreground">Prototype</h3>
			<div className="flex min-h-8 items-center gap-2">
				<span className="w-[72px] shrink-0 truncate text-xs text-muted-foreground">Link to</span>
				<div className="flex min-w-0 flex-1 items-center">
					{code ? (
						<span
							className="truncate font-mono text-[11px] text-subtle-foreground"
							title="Written as code: edit it in the Code tab"
						>
							Set in code
						</span>
					) : (
						<DropdownMenu modal={false}>
							<DropdownMenuTrigger asChild>
								<Button
									variant="outline"
									size="xs"
									disabled={disabled}
									aria-label="Link to"
									title={target?.kind === "broken" ? `${target.to} is not a screen of this project` : undefined}
									className="h-7 w-full min-w-0 justify-between gap-1 px-2 text-xs font-normal"
								>
									<span className="flex min-w-0 items-center gap-1.5">
										{target?.kind === "broken" ? (
											<CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />
										) : target?.kind === "back" ? (
											<CornerUpLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
										) : target ? (
											<Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
										) : null}
										<span className={cn("truncate", !target && "text-subtle-foreground")}>{label}</span>
									</span>
									<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="max-h-80 min-w-44">
								<DropdownMenuRadioGroup
									value={value}
									onValueChange={(next) => next !== value && onChange(element, next === NONE ? null : next)}
								>
									<DropdownMenuRadioItem value={NONE} className="text-[13px]">
										None
									</DropdownMenuRadioItem>
									<DropdownMenuSeparator />
									{screens.length === 0 ? (
										<p className="px-2 py-1.5 text-xs text-subtle-foreground">No other screens yet</p>
									) : null}
									{screens.map((screen) => (
										<DropdownMenuRadioItem key={screen.file} value={screen.file} className="text-[13px]">
											<span className="truncate">{nameOf(screen.file)}</span>
										</DropdownMenuRadioItem>
									))}
									{target?.kind === "broken" ? (
										<DropdownMenuRadioItem value={value} className="text-[13px] text-muted-foreground">
											<span className="truncate">Missing: {target.to}</span>
										</DropdownMenuRadioItem>
									) : null}
									<DropdownMenuSeparator />
									<DropdownMenuRadioItem value={BACK} className="text-[13px]">
										Back
										<span className="ml-auto pl-3 text-xs text-subtle-foreground">previous screen</span>
									</DropdownMenuRadioItem>
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			</div>
		</section>
	);
}
