import { useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
	CommandMenu,
	CommandMenuEmpty,
	CommandMenuGroup,
	CommandMenuGroupLabel,
	CommandMenuInput,
	CommandMenuItem,
	CommandMenuList,
	CommandMenuShortcut,
} from "@/components/ui/uai/command-menu";
import { groupActions, inPalette } from "@/lib/action-groups";
import { type Action, actionById, shortcutOf } from "@/lib/actions";
import { cn } from "@/lib/utils";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	actions: readonly Action[];
};

/**
 * ⌘K: search and run any editor action. Disabled actions stay listed, greyed, so the palette also shows what
 * exists and its shortcut; they just can't be picked.
 */
export function CommandPalette({ open, onOpenChange, actions }: Props) {
	const chosen = useRef<string | null>(null);
	const groups = groupActions(actions, inPalette);

	const choose = (id: string) => {
		chosen.current = id;
		onOpenChange(false);
	};

	// Runs once the dialog is gone and focus is back, so a menu or dialog the action opens isn't dismissed at once
	const runChosen = () => {
		const action = chosen.current ? actionById(actions, chosen.current) : undefined;

		chosen.current = null;

		if (action?.enabled) requestAnimationFrame(() => action.run());
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				aria-describedby={undefined}
				onCloseAutoFocus={runChosen}
				className="top-[18%] translate-y-0 gap-0 overflow-hidden rounded-[14px] p-0 sm:max-w-lg"
			>
				<DialogTitle className="sr-only">Command palette</DialogTitle>
				<CommandMenu label="Commands" onDismiss={() => onOpenChange(false)} className="rounded-none border-0">
					<CommandMenuInput placeholder="Search actions…" autoFocus />
					<CommandMenuList className="max-h-[min(24rem,60vh)]">
						{groups.map(({ group, actions: members }) => (
							<CommandMenuGroup key={group}>
								<CommandMenuGroupLabel>{group}</CommandMenuGroupLabel>
								{members.map((action) => {
									const shortcut = shortcutOf(action);

									return (
										<CommandMenuItem
											key={action.id}
											value={action.label}
											keywords={[group]}
											disabled={!action.enabled}
											onSelect={() => choose(action.id)}
											className={cn(action.destructive && action.enabled && "text-destructive")}
										>
											{action.label}
											{shortcut && <CommandMenuShortcut>{shortcut}</CommandMenuShortcut>}
										</CommandMenuItem>
									);
								})}
							</CommandMenuGroup>
						))}
					</CommandMenuList>
					<CommandMenuEmpty />
				</CommandMenu>
			</DialogContent>
		</Dialog>
	);
}
