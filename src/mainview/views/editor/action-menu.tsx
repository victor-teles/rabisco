import {
	ContextMenuCheckboxItem,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { type Action, actionById, shortcutOf } from "@/lib/actions";

export const SEPARATOR = "-";

type Submenu<Item> = { label: string; items: Item[] };

/** An action id, an id prefix ending in `*` for every action that has it, `SEPARATOR`, or a submenu */
export type MenuEntry = string | { label: string; items: MenuEntry[] };

type MenuItem = Action | typeof SEPARATOR | { label: string; items: MenuItem[] };

const isSubmenu = <Item,>(entry: string | Action | Submenu<Item>): entry is Submenu<Item> =>
	typeof entry === "object" && "items" in entry;

/** Ids missing from `actions` are left out, and so are the separators they leave at an edge or doubled */
function resolve(actions: readonly Action[], entries: readonly MenuEntry[]): MenuItem[] {
	const kept: MenuItem[] = [];

	for (const entry of entries) {
		const last = kept.at(-1);

		if (isSubmenu(entry)) {
			const items = resolve(actions, entry.items);

			if (items.length) kept.push({ label: entry.label, items });
		} else if (entry === SEPARATOR) {
			if (last !== undefined && last !== SEPARATOR) kept.push(SEPARATOR);
		} else if (entry.endsWith("*")) {
			const prefix = entry.slice(0, -1);
			kept.push(...actions.filter((action) => action.id.startsWith(prefix)));
		} else {
			const action = actionById(actions, entry);

			if (action) kept.push(action);
		}
	}

	if (kept.at(-1) === SEPARATOR) kept.pop();

	return kept;
}

/** Right-click menu items that run actions from the registry and show their shortcuts */
export function ActionMenuItems({ actions, entries }: { actions: readonly Action[]; entries: readonly MenuEntry[] }) {
	return <MenuItems items={resolve(actions, entries)} />;
}

const isCheckable = (item: MenuItem) => item !== SEPARATOR && !isSubmenu(item) && item.checked !== undefined;

function MenuItems({ items }: { items: MenuItem[] }) {
	const inset = items.some(isCheckable);

	return items.map((item, i) => {
		if (item === SEPARATOR) return <ContextMenuSeparator key={`separator-${i}`} />;

		if (isSubmenu(item)) {
			return (
				<ContextMenuSub key={item.label}>
					<ContextMenuSubTrigger>{item.label}</ContextMenuSubTrigger>
					<ContextMenuSubContent className="w-60">
						<MenuItems items={item.items} />
					</ContextMenuSubContent>
				</ContextMenuSub>
			);
		}

		const shortcut = shortcutOf(item);

		if (item.checked !== undefined) {
			return (
				<ContextMenuCheckboxItem key={item.id} checked={item.checked} disabled={!item.enabled} onSelect={item.run}>
					<span className="truncate">{item.label}</span>
				</ContextMenuCheckboxItem>
			);
		}

		return (
			<ContextMenuItem
				key={item.id}
				inset={inset}
				disabled={!item.enabled}
				variant={item.destructive ? "destructive" : "default"}
				onSelect={item.run}
			>
				{item.label}
				{shortcut ? <ContextMenuShortcut>{shortcut}</ContextMenuShortcut> : null}
			</ContextMenuItem>
		);
	});
}

/** For `onCloseAutoFocus`: an action that moved focus (the chat composer, a text edit) keeps it */
export function keepMovedFocus(event: Event) {
	const focused = document.activeElement;

	if (focused && focused !== document.body && !focused.closest("[role=menu]")) event.preventDefault();
}
