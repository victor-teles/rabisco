import { Fragment } from "react";
import { Frame } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type Action, actionById } from "@/lib/actions";
import { DEVICE_PRESETS, PRESET_KINDS } from "@/lib/device-presets";
import { SEPARATOR, type MenuEntry } from "./action-menu";
import { presetActionId } from "./screen-actions";
import { NEW_SCREEN_KEYS } from "./shortcuts";

/** The presets submenu of the canvas right-click menu */
export const NEW_SCREEN_SUBMENU: MenuEntry = {
	label: "New screen from preset",
	items: [
		...PRESET_KINDS.flatMap(({ kind }) => [
			...DEVICE_PRESETS.flatMap((preset) => (preset.kind === kind ? [presetActionId(preset)] : [])),
			SEPARATOR,
		]),
		"new-screen-custom",
	],
};

/** The toolbar's new screen button: a blank screen for the project's device, a preset or a custom size */
export function NewScreenMenu({ actions }: { actions: readonly Action[] }) {
	const run = (id: string) => actionById(actions, id)?.run();

	return (
		// Not modal, so the custom size dialog it opens gets the pointer back
		<DropdownMenu modal={false}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon-sm" aria-label="New screen">
							<Frame />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">
					New screen <Kbd>{NEW_SCREEN_KEYS}</Kbd>
				</TooltipContent>
			</Tooltip>
			{/* Naming the new screen focuses the inspector; focus coming back here would take it away */}
			<DropdownMenuContent
				side="top"
				align="center"
				className="w-60"
				onCloseAutoFocus={(event) => event.preventDefault()}
			>
				<DropdownMenuItem onSelect={() => run("new-screen")}>
					Blank screen
					<DropdownMenuShortcut>{NEW_SCREEN_KEYS}</DropdownMenuShortcut>
				</DropdownMenuItem>
				{PRESET_KINDS.map(({ kind, label }) => (
					<Fragment key={kind}>
						<DropdownMenuSeparator />
						<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{label}</DropdownMenuLabel>
						{DEVICE_PRESETS.map((preset) =>
							preset.kind === kind ? (
								<DropdownMenuItem key={preset.id} onSelect={() => run(presetActionId(preset))}>
									{preset.label}
									<DropdownMenuShortcut className="tracking-normal tabular-nums">
										{preset.width} × {preset.height}
									</DropdownMenuShortcut>
								</DropdownMenuItem>
							) : null,
						)}
					</Fragment>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={() => run("new-screen-custom")}>Custom size…</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
