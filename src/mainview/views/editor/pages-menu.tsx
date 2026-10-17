import { useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MAX_PAGE_NAME } from "../../../shared/pages";
import type { CanvasPage } from "../../../shared/types";

type Props = {
	className?: string;
	pages: CanvasPage[];
	current: CanvasPage;
	renaming: string | null;
	onGo: (id: string) => void;
	onAdd: () => void;
	onStartRename: (id: string) => void;
	onRename: (id: string, name: string | null) => void;
	onDelete: (id: string) => void;
};

/** Figma's page list, in a popover: click to open a page, double-click to rename, right-click for more */
export function PagesMenu({
	className,
	pages,
	current,
	renaming,
	onGo,
	onAdd,
	onStartRename,
	onRename,
	onDelete,
}: Props) {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open || renaming !== null} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={cn("h-7 max-w-48 gap-1 px-2 text-[13px] font-normal", className)}
					aria-label={`Page: ${current.name}. Change page`}
				>
					<span className="truncate">{current.name}</span>
					<ChevronDown className="size-3.5 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent side="bottom" align="start" className="w-60 p-1">
				<div role="group" aria-label="Pages" className="flex flex-col">
					{pages.map((page) =>
						renaming === page.id ? (
							<Input
								key={page.id}
								autoFocus
								defaultValue={page.name}
								maxLength={MAX_PAGE_NAME}
								aria-label="Page name"
								className="h-8"
								onFocus={(event) => event.currentTarget.select()}
								onBlur={(event) => onRename(page.id, event.currentTarget.value)}
								onKeyDown={(event) => {
									event.stopPropagation();

									if (event.key === "Enter") onRename(page.id, event.currentTarget.value);
									else if (event.key === "Escape") {
										event.preventDefault();
										onRename(page.id, null);
									}
								}}
							/>
						) : (
							<ContextMenu key={page.id}>
								<ContextMenuTrigger asChild>
									<button
										type="button"
										aria-current={page.id === current.id ? "page" : undefined}
										className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
										onClick={() => {
											onGo(page.id);
											setOpen(false);
										}}
										onDoubleClick={() => onStartRename(page.id)}
									>
										<Check className={cn("size-4 shrink-0", page.id !== current.id && "invisible")} />
										<span className="truncate">{page.name}</span>
									</button>
								</ContextMenuTrigger>
								<ContextMenuContent>
									<ContextMenuItem onSelect={() => onStartRename(page.id)}>Rename</ContextMenuItem>
									<ContextMenuSeparator />
									<ContextMenuItem variant="destructive" disabled={pages.length < 2} onSelect={() => onDelete(page.id)}>
										Delete page
									</ContextMenuItem>
								</ContextMenuContent>
							</ContextMenu>
						),
					)}
				</div>
				<div className="mt-1 border-t pt-1">
					<button
						type="button"
						className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent"
						onClick={() => {
							onAdd();
							setOpen(false);
						}}
					>
						<Plus className="size-4" />
						Add page
					</button>
					{pages.length > 1 ? (
						<p className="px-2 pt-1 pb-1.5 text-[11px] text-subtle-foreground">
							<Kbd>PgUp</Kbd> <Kbd>PgDn</Kbd> to switch. Double-click to rename.
						</p>
					) : null}
				</div>
			</PopoverContent>
		</Popover>
	);
}
