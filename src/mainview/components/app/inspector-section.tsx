import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const CLOSED_KEY = "rabisco:inspector-closed";

function readClosed(): Set<string> {
	try {
		const list: unknown = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]");

		return new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
	} catch {
		return new Set();
	}
}

/** Remembered by title, so "Layout" stays closed for every element */
function useSectionOpen(title: string): [boolean, (open: boolean) => void] {
	const [open, setOpen] = useState(() => !readClosed().has(title));

	const change = (next: boolean) => {
		setOpen(next);
		const closed = readClosed();

		if (next) closed.delete(title);
		else closed.add(title);
		localStorage.setItem(CLOSED_KEY, JSON.stringify([...closed]));
	};

	return [open, change];
}

/** A titled inspector group that folds; `action` stays visible when it is closed */
export function InspectorSection({
	title,
	action,
	className,
	children,
}: {
	title: string;
	action?: React.ReactNode;
	className?: string;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useSectionOpen(title);

	return (
		<Collapsible open={open} onOpenChange={setOpen} asChild>
			<section className={cn("group/section flex flex-col gap-2", !open && "gap-0", className)}>
				<div className="flex h-5 items-center justify-between">
					<CollapsibleTrigger className="-ml-1 flex h-5 min-w-0 items-center gap-1 rounded-sm px-1 text-xs font-medium text-subtle-foreground outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
						<span className="truncate">{title}</span>
						<ChevronDown
							className={cn(
								"size-3 shrink-0 opacity-0 transition-[transform,opacity] duration-150 group-hover/section:opacity-100 group-focus-within/section:opacity-100",
								!open && "-rotate-90 opacity-100",
							)}
							aria-hidden
						/>
					</CollapsibleTrigger>
					{action}
				</div>
				<CollapsibleContent className="flex flex-col gap-2">{children}</CollapsibleContent>
			</section>
		</Collapsible>
	);
}
