import { ContextMenuCheckboxItem, ContextMenuLabel } from "@/components/ui/context-menu";
import { setShowFps, useShowFps } from "@/hooks/use-show-fps";

/** Development builds only */
export function DebugMenuItems() {
	const showFps = useShowFps();

	return (
		<>
			<ContextMenuLabel className="text-xs text-muted-foreground">Debug</ContextMenuLabel>
			<ContextMenuCheckboxItem checked={showFps} onCheckedChange={setShowFps}>
				Show FPS
			</ContextMenuCheckboxItem>
		</>
	);
}
