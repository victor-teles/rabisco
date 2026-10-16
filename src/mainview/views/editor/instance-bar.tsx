import { Component } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Override } from "../../../shared/components/instances";

export type InstanceMode = "component" | "usage";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function InstanceBar({
	name,
	usages,
	mode,
	overrides,
	onModeChange,
	onGoTo,
	onReset,
	onDone,
}: {
	name: string;
	usages: number;
	mode: InstanceMode;
	overrides: Override[];
	onModeChange: (mode: InstanceMode) => void;
	onGoTo: () => void;
	onReset: () => void;
	onDone: () => void;
}) {
	return (
		<div
			data-instance-bar
			className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-background/95 py-1 pr-1 pl-2.5 text-xs shadow-sm backdrop-blur"
		>
			<button
				type="button"
				className="flex items-center gap-1.5 font-medium text-violet-600 hover:underline dark:text-violet-400"
				title="Go to component"
				onClick={onGoTo}
			>
				<Component className="size-3.5" />
				{name}
			</button>
			<span className="whitespace-nowrap text-muted-foreground tabular-nums">{plural(usages, "usage")}</span>
			<ToggleGroup
				type="single"
				variant="outline"
				size="sm"
				value={mode}
				onValueChange={(value) => (value === "component" || value === "usage") && onModeChange(value)}
			>
				<ToggleGroupItem value="component" className="h-6 px-2 text-xs" title="Edits change every usage">
					Component
				</ToggleGroupItem>
				<ToggleGroupItem value="usage" className="h-6 px-2 text-xs" title="Edits override this usage only">
					This usage
				</ToggleGroupItem>
			</ToggleGroup>
			{overrides.length ? (
				<Button
					variant="ghost"
					size="sm"
					className="h-6 px-2 text-xs"
					title={overrides.map((o) => `${o.name}: ${o.value}`).join("\n")}
					onClick={onReset}
				>
					Reset {plural(overrides.length, "override")}
				</Button>
			) : null}
			<Button variant="ghost" size="sm" className="h-6 gap-1.5 px-2 text-xs" onClick={onDone}>
				Done <Kbd>Esc</Kbd>
			</Button>
		</div>
	);
}
