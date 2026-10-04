import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/hooks/use-theme";

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
	const next = theme === "dark" ? "light" : "dark";
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={`Switch to ${next} mode`}>
					{theme === "dark" ? <Sun /> : <Moon />}
				</Button>
			</TooltipTrigger>
			<TooltipContent>Switch to {next} mode</TooltipContent>
		</Tooltip>
	);
}
