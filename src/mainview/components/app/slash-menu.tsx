import { useLayoutEffect, useState, type KeyboardEvent } from "react";
import {
	CommandMenu,
	CommandMenuGroup,
	CommandMenuGroupLabel,
	CommandMenuItem,
	CommandMenuList,
	useCommandMenuKeyDown,
} from "@/components/ui/uai/command-menu";
import { usePromptComposer } from "@/components/ui/uai/prompt-composer";
import { type ChatCommand, commandKeywords, matchesCommand, slashQuery } from "@/lib/chat-commands";

export type SlashKeyHandler = (event: KeyboardEvent<HTMLElement>) => void;

/** Lends the menu's keys to the composer's textarea, which keeps the focus */
function KeyBridge({ onKeys }: { onKeys: (handler: SlashKeyHandler | null) => void }) {
	const onKeyDown = useCommandMenuKeyDown();

	useLayoutEffect(() => {
		onKeys(onKeyDown);

		return () => onKeys(null);
	});

	return null;
}

/**
 * Opens above the composer while the prompt is a slash and a name. A command that takes arguments fills in
 * `/name `; one that doesn't runs at once.
 */
export function SlashMenu({
	commands,
	onKeys,
	onRun,
}: {
	commands: readonly ChatCommand[];
	/** Receives the menu's key handler while it is open, for the textarea's `onKeyDown` */
	onKeys: (handler: SlashKeyHandler | null) => void;
	/** `false` when it didn't run, so the prompt stays */
	onRun: (command: ChatCommand) => boolean | void;
}) {
	const composer = usePromptComposer("SlashMenu");
	const query = slashQuery(composer.prompt);
	/** The prompt Escape closed the menu at; typing on opens it again */
	const [dismissedAt, setDismissedAt] = useState<string | null>(null);
	const matching = query === null ? [] : commands.filter((command) => matchesCommand(query, command));

	if (query === null || composer.locked || dismissedAt === composer.prompt || !matching.length) return null;

	const groups = new Map<string, ChatCommand[]>();

	for (const command of matching) groups.set(command.group, [...(groups.get(command.group) ?? []), command]);
	const dismiss = () => setDismissedAt(composer.prompt);

	const choose = (command: ChatCommand) => {
		if (command.argumentHint) {
			composer.setPrompt(`/${command.name} `);
			composer.inputRef.current?.focus();
		} else if (onRun(command) !== false) composer.setPrompt("");
	};

	return (
		<CommandMenu
			variant="floating"
			label="Chat commands"
			value={query}
			onValueChange={dismiss}
			onDismiss={dismiss}
			className="absolute inset-x-0 bottom-full z-20 mb-2"
		>
			<KeyBridge onKeys={onKeys} />
			<CommandMenuList className="max-h-64">
				{[...groups].map(([group, members]) => (
					<CommandMenuGroup key={group}>
						<CommandMenuGroupLabel>{group}</CommandMenuGroupLabel>
						{members.map((command) => (
							<CommandMenuItem
								key={`${command.kind}:${command.name}`}
								value={command.name}
								keywords={commandKeywords(command)}
								// The textarea keeps the focus, so a click doesn't close the menu first
								onPointerDown={(event) => event.preventDefault()}
								onSelect={() => choose(command)}
							>
								<span className="shrink-0 font-mono text-xs">/{command.name}</span>
								<span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">{command.description}</span>
								{command.argumentHint ? (
									<span className="shrink-0 font-mono text-[11px] font-normal text-subtle-foreground">
										{command.argumentHint}
									</span>
								) : null}
							</CommandMenuItem>
						))}
					</CommandMenuGroup>
				))}
			</CommandMenuList>
		</CommandMenu>
	);
}
