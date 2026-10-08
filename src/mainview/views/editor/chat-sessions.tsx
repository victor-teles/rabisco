import { History, SquarePen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	CommandMenu,
	CommandMenuEmpty,
	CommandMenuInput,
	CommandMenuItem,
	CommandMenuList,
} from "@/components/ui/uai/command-menu";
import { formatWhen } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ChatSummary } from "../../../shared/chats";
import { NEW_CHAT_KEYS } from "./shortcuts";

type Props = {
	chats: ChatSummary[];
	chatId: string;
	/** Empty: the open chat has no messages, so a new one would look the same */
	canStartNew: boolean;
	/** Why sessions can't change right now (a generation is running) */
	busyReason?: string;
	onNew: () => void;
	onOpen: (chatId: string) => void;
	onDelete: (chatId: string) => void;
	historyOpen: boolean;
	onHistoryOpenChange: (open: boolean) => void;
};

/** New chat and the list of past chats, in the side panel's header while the Chat tab shows */
export function ChatSessions({
	chats,
	chatId,
	canStartNew,
	busyReason,
	onNew,
	onOpen,
	onDelete,
	historyOpen,
	onHistoryOpenChange,
}: Props) {
	const close = () => onHistoryOpenChange(false);

	return (
		<div className="flex items-center">
			<Popover open={historyOpen} onOpenChange={onHistoryOpenChange}>
				<Tooltip>
					<TooltipTrigger asChild>
						<PopoverTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								className="text-muted-foreground"
								aria-label="Chat history"
								disabled={chats.length === 0}
							>
								<History />
							</Button>
						</PopoverTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom">Chat history</TooltipContent>
				</Tooltip>
				<PopoverContent align="end" className="w-80 p-0">
					<CommandMenu label="Chats" variant="compact" onDismiss={close} className="border-0">
						<CommandMenuInput placeholder="Search chats…" autoFocus />
						<CommandMenuList className="max-h-[min(22rem,60vh)]">
							{chats.map((chat) => (
								<CommandMenuItem
									key={chat.id}
									value={chat.title}
									disabled={Boolean(busyReason) && chat.id !== chatId}
									onSelect={() => {
										onOpen(chat.id);
										close();
									}}
									className="group/chat pr-1"
								>
									<span className={cn("min-w-0 flex-1 truncate", chat.id === chatId && "text-primary")}>
										{chat.title}
									</span>
									<span className="shrink-0 text-[11px] font-normal text-subtle-foreground tabular-nums group-hover/chat:hidden">
										{formatWhen(chat.updatedAt)}
									</span>
									<Button
										variant="ghost"
										size="icon-xs"
										className="hidden text-muted-foreground group-hover/chat:inline-flex hover:text-destructive"
										aria-label={`Delete “${chat.title}”`}
										disabled={Boolean(busyReason) && chat.id === chatId}
										onClick={(event) => {
											event.preventDefault();
											onDelete(chat.id);
										}}
									>
										<Trash2 />
									</Button>
								</CommandMenuItem>
							))}
						</CommandMenuList>
						<CommandMenuEmpty />
					</CommandMenu>
				</PopoverContent>
			</Popover>
			<Tooltip>
				<TooltipTrigger asChild>
					{/* A span, so the tooltip still explains a disabled button */}
					<span>
						<Button
							variant="ghost"
							size="icon-sm"
							className="text-muted-foreground"
							aria-label="New chat"
							disabled={!canStartNew || Boolean(busyReason)}
							onClick={onNew}
						>
							<SquarePen />
						</Button>
					</span>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{busyReason ?? (
						<>
							New chat <Kbd>{NEW_CHAT_KEYS}</Kbd>
						</>
					)}
				</TooltipContent>
			</Tooltip>
		</div>
	);
}
