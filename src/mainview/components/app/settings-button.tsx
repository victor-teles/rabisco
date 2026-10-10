import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openSettings } from "@/hooks/use-providers";

export function SettingsButton() {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="ghost" size="icon-sm" onClick={() => openSettings()} aria-label="AI providers">
					<Settings2 />
				</Button>
			</TooltipTrigger>
			<TooltipContent>AI providers</TooltipContent>
		</Tooltip>
	);
}
