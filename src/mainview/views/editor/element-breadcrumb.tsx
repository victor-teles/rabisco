import { Fragment, memo, useEffect } from "react";
import {
	Breadcrumb,
	BreadcrumbEllipsis,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { elementHover } from "@/lib/element-hover";
import { ancestorsOf, type Crumb } from "@/lib/element-nav";
import { cn } from "@/lib/utils";
import { findElement, parseJsx } from "../../../shared/jsx";

/** Ancestors past this many fold into a menu, keeping the nearest ones */
const SHOWN_ANCESTORS = 3;

type ElementBreadcrumbProps = {
	file: string;
	source: string;
	start: number;
	screenName: string;
	/** `null` selects the screen */
	onSelect: (start: number | null) => void;
};

const nameClass = (crumb: Crumb) =>
	cn("font-mono text-[11px]", crumb.component && "text-violet-700 dark:text-violet-300");

/** The selected element's ancestors, outermost first: a click selects one, a hover outlines it on the canvas */
export const ElementBreadcrumb = memo(function ElementBreadcrumb({
	file,
	source,
	start,
	screenName,
	onSelect,
}: ElementBreadcrumbProps) {
	useEffect(() => () => elementHover.clear("layers"), []);
	const element = findElement(parseJsx(source), start);

	if (!element || element.name === null) return null;
	const ancestors = ancestorsOf(source, start);
	const folded = ancestors.length > SHOWN_ANCESTORS ? ancestors.slice(0, -(SHOWN_ANCESTORS - 1)) : [];
	const shown = ancestors.slice(folded.length);
	const current: Crumb = { start, name: element.name, component: !element.intrinsic };

	// The crumb that was clicked unmounts without a pointerleave
	const pick = (target: number | null) => {
		elementHover.clear("layers");
		onSelect(target);
	};

	const hover = (crumb: Crumb) => ({
		onPointerEnter: () => elementHover.set({ file, start: crumb.start, from: "layers" }),
		onPointerLeave: () => elementHover.clear("layers"),
	});

	return (
		<Breadcrumb className="border-b px-4 py-2">
			<BreadcrumbList className="gap-1 text-xs sm:gap-1">
				<BreadcrumbItem>
					<BreadcrumbLink asChild>
						<button type="button" className="max-w-24 truncate" onClick={() => pick(null)}>
							{screenName}
						</button>
					</BreadcrumbLink>
				</BreadcrumbItem>
				{folded.length ? (
					<>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<DropdownMenu modal={false}>
								<DropdownMenuTrigger
									className="flex items-center rounded-sm hover:text-foreground"
									aria-label={`${folded.length} more ancestors`}
								>
									<BreadcrumbEllipsis className="size-4" />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start">
									{folded.map((crumb) => (
										<DropdownMenuItem key={crumb.start} onSelect={() => pick(crumb.start)} {...hover(crumb)}>
											<span className={nameClass(crumb)}>{crumb.name}</span>
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						</BreadcrumbItem>
					</>
				) : null}
				{shown.map((crumb) => (
					<Fragment key={crumb.start}>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<button
									type="button"
									className={cn("max-w-28 truncate", nameClass(crumb))}
									onClick={() => pick(crumb.start)}
									{...hover(crumb)}
								>
									{crumb.name}
								</button>
							</BreadcrumbLink>
						</BreadcrumbItem>
					</Fragment>
				))}
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbPage className={cn("max-w-28 truncate", nameClass(current))}>{current.name}</BreadcrumbPage>
				</BreadcrumbItem>
			</BreadcrumbList>
		</Breadcrumb>
	);
});
