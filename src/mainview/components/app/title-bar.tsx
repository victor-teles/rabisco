import type { ComponentProps, MouseEvent } from "react";
import { api, isDesktop } from "@/lib/rpc";
import { cn } from "@/lib/utils";

const NO_DRAG = "electrobun-webkit-app-region-no-drag";

/**
 * A double-click on the bar itself zooms the window, as on a native title bar; controls keep their own double-click.
 * React bubbles events from portals (a popover's page list) through the bar, so the target must be in its DOM.
 */
function onTitleBarDoubleClick(event: MouseEvent<HTMLElement>) {
	const { target, currentTarget } = event;

	if (!isDesktop || !(target instanceof Element) || !currentTarget.contains(target) || target.closest(`.${NO_DRAG}`))
		return;

	void api.titleBarDoubleClick({});
}

/** Drags the window; interactive children opt out with `no-drag`. The left inset clears the traffic lights. */
export function TitleBar({ className, children, onDoubleClick, ...props }: ComponentProps<"header">) {
	return (
		<header
			className={cn(
				"electrobun-webkit-app-region-drag flex h-12 shrink-0 items-center gap-2 border-b bg-background pr-3",
				isDesktop ? "pl-[84px]" : "pl-3",
				className,
			)}
			onDoubleClick={(event) => {
				onDoubleClick?.(event);
				onTitleBarDoubleClick(event);
			}}
			{...props}
		>
			{children}
		</header>
	);
}

export function NoDrag({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn(NO_DRAG, className)} {...props} />;
}
