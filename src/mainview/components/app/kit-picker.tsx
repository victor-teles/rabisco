import { Blocks, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isKitId, kitById, STARTER_KITS, type KitId } from "../../../shared/components/starter-kits";

/** The components a new project starts with in `components/`, on top of the shadcn primitives every project has */
export function KitPicker({
	value,
	onChange,
	className,
}: {
	value: KitId;
	onChange: (value: KitId) => void;
	className?: string;
}) {
	const current = kitById(value);

	return (
		<DropdownMenu modal={false}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="xs"
							aria-label={`Starter kit: ${current.label}`}
							className={cn("h-7 gap-1.5 px-1.5 text-muted-foreground", className)}
						>
							<Blocks className="size-3.5" />
							<span className="text-xs">{current.label}</span>
							<ChevronDown className="size-3 shrink-0" />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">Starter kit</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start" side="top" className="w-76">
				<DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
					Adds components the screens reuse
				</DropdownMenuLabel>
				<DropdownMenuRadioGroup value={value} onValueChange={(next) => isKitId(next) && onChange(next)}>
					{STARTER_KITS.map((kit) => {
						const count = Object.keys(kit.files).length;

						return (
							<DropdownMenuRadioItem key={kit.id} value={kit.id} className="py-1.5">
								<span className="flex min-w-0 flex-col">
									<span className="flex items-baseline gap-1.5 text-[13px]">
										{kit.label}
										<span className="text-xs text-subtle-foreground">
											{count === 0 ? "Built in" : `${count} components`}
										</span>
									</span>
									<span className="truncate text-xs text-muted-foreground">{kit.description}</span>
								</span>
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
