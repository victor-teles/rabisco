import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LayoutList, MessageSquare, PanelLeftClose, type LucideIcon } from "lucide-react";
import { ResizeHandle, usePanelSize } from "@/components/app/resize-handle";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isBoolean } from "../../../shared/guards";
import { SCREENS_VIEW_KEYS, SIDE_PANEL_KEYS } from "./shortcuts";

export type SideTab = "chat" | "screens";

const TAB_KEY = "rabisco:side-tab";

const OPEN_KEY = "rabisco:side-open";

const WIDTH = { key: "rabisco:side-width", initial: 340, min: 280, max: 560 };

const isSideTab = (value: string | null): value is SideTab => value === "chat" || value === "screens";

function storedOpen() {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "true");

		return isBoolean(value) ? value : true;
	} catch {
		return true;
	}
}

function storedTab(): SideTab {
	const value = localStorage.getItem(TAB_KEY);

	return isSideTab(value) ? value : "chat";
}

/** The left panel's tab and whether it is open, kept across sessions like the other UI preferences */
export function useSidePanel() {
	const [tab, setTab] = useState(storedTab);
	const [open, setOpen] = useState(storedOpen);

	useEffect(() => localStorage.setItem(TAB_KEY, tab), [tab]);
	useEffect(() => localStorage.setItem(OPEN_KEY, JSON.stringify(open)), [open]);

	const show = useCallback((next: SideTab) => {
		setTab(next);
		setOpen(true);
	}, []);

	/** Back to the chat when the tab is already showing */
	const toggleTab = useCallback(
		(next: SideTab) => {
			if (open && tab === next) setTab("chat");
			else show(next);
		},
		[open, tab, show],
	);

	const toggle = useCallback(() => setOpen((value) => !value), []);

	return { tab, open, show, toggleTab, toggle };
}

export type SidePanelState = ReturnType<typeof useSidePanel>;

const TABS: { tab: SideTab; label: string; icon: LucideIcon; keys?: string }[] = [
	{ tab: "chat", label: "Chat", icon: MessageSquare },
	{ tab: "screens", label: "Screens", icon: LayoutList, keys: SCREENS_VIEW_KEYS },
];

/** Chat and the screens list, side by side as tabs. The chat stays mounted so a draft survives switching. */
export function SidePanel({
	state,
	chat,
	screens,
	screenCount,
	revealChat = 0,
	chatActions,
}: {
	state: SidePanelState;
	chat: ReactNode;
	/** In the header while the chat shows */
	chatActions?: ReactNode;
	screens: ReactNode;
	screenCount: number;
	/** Bumped to show the chat, e.g. when Ask AI puts the caret there */
	revealChat?: number;
}) {
	const { tab, open, show, toggle } = state;
	const size = usePanelSize(WIDTH);

	useEffect(() => {
		if (revealChat) show("chat");
	}, [revealChat, show]);

	const rail = (
		<div className="flex flex-col items-center gap-1 py-2">
			{TABS.map((item) => (
				<Tooltip key={item.tab}>
					<TooltipTrigger asChild>
						<Button variant="ghost" size="icon-sm" aria-label={item.label} onClick={() => show(item.tab)}>
							<item.icon className="text-muted-foreground" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right">
						{item.label} {item.keys ? <Kbd>{item.keys}</Kbd> : null}
					</TooltipContent>
				</Tooltip>
			))}
		</div>
	);

	const header = (
		<div className="flex h-10 shrink-0 items-center border-b px-2">
			<Tabs
				value={tab}
				onValueChange={(value) => {
					if (isSideTab(value)) show(value);
				}}
				className="gap-0"
			>
				<TabsList variant="line" className="h-8!">
					{TABS.map((item) => (
						<TabsTrigger key={item.tab} value={item.tab} className="gap-1 px-2 text-[13px]">
							{/* Inside the trigger: a tooltip's `data-state` on it would hide the active tab */}
							{item.keys ? (
								<Tooltip>
									<TooltipTrigger asChild>
										<span>{item.label}</span>
									</TooltipTrigger>
									<TooltipContent side="bottom">
										{item.label} <Kbd>{item.keys}</Kbd>
									</TooltipContent>
								</Tooltip>
							) : (
								item.label
							)}
							{item.tab === "screens" && screenCount ? (
								<span className="text-[11px] font-normal text-subtle-foreground tabular-nums">{screenCount}</span>
							) : null}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>
			<div className="ml-auto flex items-center">
				{tab === "chat" ? chatActions : null}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							className="text-muted-foreground"
							aria-label="Hide panel"
							onClick={toggle}
						>
							<PanelLeftClose />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						Hide panel <Kbd>{SIDE_PANEL_KEYS}</Kbd>
					</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);

	// One tree either way, so collapsing the panel doesn't remount the chat
	return (
		<aside
			className={cn("relative flex shrink-0 flex-col border-r bg-background", !open && "w-11")}
			style={open ? { width: size.width } : undefined}
		>
			{open ? header : rail}
			<div className={cn("flex min-h-0 flex-1 flex-col", (!open || tab !== "chat") && "hidden")}>{chat}</div>
			{open && tab === "screens" ? screens : null}
			{open ? <ResizeHandle edge="right" label="Resize the panel" panel={size} /> : null}
		</aside>
	);
}
