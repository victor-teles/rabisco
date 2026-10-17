import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Bookmark, BookmarkPlus, History, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	CommandMenu,
	CommandMenuEmpty,
	CommandMenuGroup,
	CommandMenuGroupLabel,
	CommandMenuInput,
	CommandMenuItem,
	CommandMenuList,
} from "@/components/ui/uai/command-menu";
import { formatChord } from "@/lib/actions";
import { isMac } from "@/lib/platform";
import { api } from "@/lib/rpc";
import { formatWhen } from "@/lib/time";
import type { ChatSummary } from "../../../shared/chats";
import {
	distinctPrompts,
	pastPrompts,
	promptsForScreen,
	type PastPrompt,
	type SavedPrompt,
} from "../../../shared/prompts";
import type { ChatMessage, Frame } from "../../../shared/types";

/** Older chats are read only when the library opens, newest first */
const MAX_CHATS = 30;

const MAX_RECENT = 12;

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	saved: SavedPrompt[];
	projectPath: string;
	chats: readonly ChatSummary[];
	chatId: string | undefined;
	messages: ChatMessage[];
	/** Its past prompts are listed; without one, the latest prompts of the project */
	screen: Frame | null;
	onInsert: (text: string) => void;
	onSave: (text: string) => void;
	onRemove: (text: string) => void;
};

/** Past prompts of every chat; a chat's messages are read once per update */
function usePastPrompts(
	open: boolean,
	path: string,
	chats: readonly ChatSummary[],
	chatId: string | undefined,
	messages: ChatMessage[],
) {
	const cache = useRef(new Map<string, PastPrompt[]>());
	const [others, setOthers] = useState<PastPrompt[]>([]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		const older = chats.filter((chat) => chat.id !== chatId).slice(0, MAX_CHATS);

		void Promise.all(
			older.map(async (chat) => {
				const key = `${path}\n${chat.id}\n${chat.updatedAt}`;
				const known = cache.current.get(key);

				if (known) return known;

				try {
					const read = pastPrompts(await api.openChat({ path, chatId: chat.id }));

					cache.current.set(key, read);

					return read;
				} catch {
					return [];
				}
			}),
		).then((lists) => {
			if (!cancelled) setOthers(lists.flat());
		});

		return () => {
			cancelled = true;
		};
	}, [open, path, chats, chatId]);

	return distinctPrompts([...pastPrompts(messages), ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

export const PROMPTS_KEYS = formatChord({ code: "KeyP", mod: true, alt: true });

const SAVE_KEY = formatChord({ code: "KeyS", mod: true });

const REMOVE_KEY = formatChord({ key: "Backspace", mod: true });

/** Opens the library from the composer's options row */
export function PromptsButton({ onOpen }: { onOpen: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					onClick={onOpen}
					aria-label="Prompts"
					aria-keyshortcuts="Alt+Meta+P"
					className="h-7 min-w-7 px-1.5 text-muted-foreground"
				>
					<Bookmark className="size-3.5" />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="top">
				Prompts <Kbd>{PROMPTS_KEYS}</Kbd>
			</TooltipContent>
		</Tooltip>
	);
}

/** A secondary action on a row; the keyboard reaches it through the shortcut in the footer */
function RowAction({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
	const press = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		onPress();
	};

	return (
		<button
			type="button"
			tabIndex={-1}
			aria-label={label}
			title={label}
			onClick={press}
			className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 group-data-[active]:opacity-100 hover:bg-background hover:text-foreground [&>svg]:size-3.5"
		>
			{children}
		</button>
	);
}

/**
 * ⌥⌘P: the project's saved prompts and the prompts sent before, for the selected screen or the whole project. Picking
 * one puts it in the composer to review; typing new text offers to save it.
 */
export function PromptLibrary({
	open,
	onOpenChange,
	saved,
	projectPath,
	chats,
	chatId,
	messages,
	screen,
	onInsert,
	onSave,
	onRemove,
}: Props) {
	const [query, setQuery] = useState("");
	const past = usePastPrompts(open, projectPath, chats, chatId, messages);
	const chosen = useRef<string | null>(null);
	const isSaved = (text: string) => saved.some((prompt) => prompt.text === text);
	const forScreen = screen ? promptsForScreen(past, screen.file) : past.slice(0, MAX_RECENT);
	const typed = query.trim();
	const offerSave = typed.length > 0 && !isSaved(typed) && !saved.some((prompt) => prompt.title === typed);

	const close = (open: boolean) => {
		if (!open) setQuery("");
		onOpenChange(open);
	};

	const choose = (text: string) => {
		chosen.current = text;
		close(false);
	};

	// Once focus is back, so the composer takes the text and the caret
	const insertChosen = () => {
		const text = chosen.current;

		chosen.current = null;

		if (text) requestAnimationFrame(() => onInsert(text));
	};

	/** ⌘S saves the active past prompt, ⌘⌫ removes the active saved one */
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!(isMac ? event.metaKey : event.ctrlKey)) return;
		const active = event.currentTarget.querySelector<HTMLElement>("[role='option'][data-active]");
		const text = active?.dataset.prompt;

		if (!text) return;

		if (event.key === "s" && active.dataset.kind === "past") {
			event.preventDefault();
			onSave(text);
		} else if (event.key === "Backspace" && active.dataset.kind === "saved") {
			event.preventDefault();
			onRemove(text);
		}
	};

	const screenName = screen?.name;

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent
				showCloseButton={false}
				aria-describedby={undefined}
				onCloseAutoFocus={insertChosen}
				className="top-[18%] translate-y-0 gap-0 overflow-hidden rounded-[14px] p-0 sm:max-w-lg"
			>
				<DialogTitle className="sr-only">Prompts</DialogTitle>
				<CommandMenu
					label="Prompts"
					value={query}
					onValueChange={setQuery}
					onDismiss={() => close(false)}
					onKeyDown={onKeyDown}
					className="rounded-none border-0"
				>
					<CommandMenuInput placeholder="Search prompts, or type one to save…" autoFocus />
					<CommandMenuList className="max-h-[min(26rem,60vh)]">
						{offerSave ? (
							<CommandMenuGroup>
								<CommandMenuItem
									value={typed}
									onSelect={() => {
										onSave(typed);
										setQuery("");
									}}
								>
									<BookmarkPlus />
									<span className="min-w-0 truncate">
										Save <span className="text-muted-foreground">“{typed}”</span> as a prompt
									</span>
								</CommandMenuItem>
							</CommandMenuGroup>
						) : null}
						<CommandMenuGroup>
							<CommandMenuGroupLabel>Saved</CommandMenuGroupLabel>
							{saved.map((prompt) => (
								<CommandMenuItem
									key={prompt.text}
									value={prompt.title}
									keywords={[prompt.text]}
									data-kind="saved"
									data-prompt={prompt.text}
									onSelect={() => choose(prompt.text)}
									className="group min-w-0"
								>
									<Bookmark />
									<span className="min-w-0 truncate">{prompt.title}</span>
									<RowAction label="Remove from prompts" onPress={() => onRemove(prompt.text)}>
										<Trash2 />
									</RowAction>
								</CommandMenuItem>
							))}
						</CommandMenuGroup>
						<CommandMenuGroup>
							<CommandMenuGroupLabel>{screenName ? `Sent for ${screenName}` : "Recent"}</CommandMenuGroupLabel>
							{forScreen.map((prompt) => (
								<CommandMenuItem
									key={prompt.id}
									value={prompt.text}
									data-kind="past"
									data-prompt={prompt.text}
									onSelect={() => choose(prompt.text)}
									className="group min-w-0"
								>
									<History />
									<span className="min-w-0 truncate">{prompt.text.split("\n")[0]}</span>
									<span className="shrink-0 text-xs font-normal text-muted-foreground group-hover:hidden group-data-[active]:hidden">
										{formatWhen(prompt.createdAt)}
									</span>
									{isSaved(prompt.text) ? null : (
										<RowAction label="Save as a prompt" onPress={() => onSave(prompt.text)}>
											<BookmarkPlus />
										</RowAction>
									)}
								</CommandMenuItem>
							))}
						</CommandMenuGroup>
						{typed || forScreen.length ? null : (
							<p className="px-2.5 py-2 text-xs text-muted-foreground">
								{screenName ? `No prompt has changed ${screenName} yet.` : "No prompts sent yet."}
								{saved.length ? null : ` Type a prompt above to save it, or save one you sent with ${SAVE_KEY}.`}
							</p>
						)}
					</CommandMenuList>
					<CommandMenuEmpty />
				</CommandMenu>
				<div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
					<span className="flex items-center gap-1">
						<Kbd>↵</Kbd> Put in the chat
					</span>
					<span className="flex items-center gap-1">
						<Kbd>{SAVE_KEY}</Kbd> Save
					</span>
					<span className="flex items-center gap-1">
						<Kbd>{REMOVE_KEY}</Kbd> Remove
					</span>
				</div>
			</DialogContent>
		</Dialog>
	);
}
