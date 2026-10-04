import type { ComponentProps } from "react";
import { isDesktop } from "@/lib/rpc";
import { cn } from "@/lib/utils";

/**
 * Window chrome for the `hiddenInset` title bar: the bar itself drags the
 * window, interactive children opt out with `no-drag`, and the left inset
 * leaves room for the macOS traffic lights.
 */
export function TitleBar({ className, children, ...props }: ComponentProps<"header">) {
	return (
		<header
			className={cn(
				"electrobun-webkit-app-region-drag flex h-12 shrink-0 items-center gap-2 border-b bg-background pr-3",
				isDesktop ? "pl-[84px]" : "pl-3",
				className,
			)}
			{...props}
		>
			{children}
		</header>
	);
}

export function NoDrag({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("electrobun-webkit-app-region-no-drag", className)} {...props} />;
}
