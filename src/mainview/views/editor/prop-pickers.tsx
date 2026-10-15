import { useState } from "react";
import { ImagePlus, Link2, Replace } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, isDesktop } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { projectComponents } from "../../../shared/components/usages";
import { swapComponent, type SwapTarget } from "../../../shared/jsx/swap";
import { isScreenFile, screenNameFromPath } from "../../../shared/project";
import { hrefScreen } from "../../../shared/prototype/links";
import type { Frame, ProjectFiles } from "../../../shared/types";

/** Copies a picked image into the project; `onPicked` gets the `src` to write */
export function ImagePickButton({
	projectPath,
	disabled,
	onPicked,
}: {
	projectPath: string;
	disabled?: boolean;
	onPicked: (src: string) => void;
}) {
	const [picking, setPicking] = useState(false);

	if (!isDesktop) return null;

	const pick = async () => {
		setPicking(true);

		try {
			const picked = await api.pickImage({ path: projectPath });

			if (picked) onPicked(picked.src);
		} catch (error) {
			toast.error("Couldn't add the image", { description: error instanceof Error ? error.message : String(error) });
		} finally {
			setPicking(false);
		}
	};

	return (
		<Button
			variant="ghost"
			size="icon-xs"
			className="size-7 shrink-0 text-muted-foreground"
			disabled={disabled || picking}
			aria-label="Choose an image"
			title="Choose an image; it is copied into public/images"
			onClick={() => void pick()}
		>
			<ImagePlus className="size-3.5" />
		</Button>
	);
}

/** Points an `href` at a screen of the project */
export function ScreenLinkMenu({
	files,
	frames,
	file,
	href,
	disabled,
	onPick,
}: {
	files: ProjectFiles;
	frames: Frame[];
	/** The screen being edited, left out of the list */
	file: string;
	href: string | null;
	disabled?: boolean;
	onPick: (screen: string) => void;
}) {
	const linked = href === null ? null : hrefScreen(href, files);

	const screens = frames.filter(
		(frame) => isScreenFile(frame.file) && files[frame.file] !== undefined && frame.file !== file,
	);

	const nameOf = (path: string) => frames.find((frame) => frame.file === path)?.name || screenNameFromPath(path);

	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon-xs"
					disabled={disabled}
					aria-label="Link to a screen"
					title={linked ? `Links to ${nameOf(linked)}` : "Link to a screen"}
					className={cn("size-7 shrink-0 text-muted-foreground", linked && "bg-accent text-accent-foreground")}
				>
					<Link2 className="size-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-h-80 min-w-44">
				<DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">Link to screen</DropdownMenuLabel>
				{screens.length === 0 ? (
					<p className="px-2 py-1.5 text-xs text-subtle-foreground">No other screens yet</p>
				) : null}
				<DropdownMenuRadioGroup value={linked ?? ""} onValueChange={(next) => next !== linked && onPick(next)}>
					{screens.map((screen) => (
						<DropdownMenuRadioItem key={screen.file} value={screen.file} className="text-[13px]">
							<span className="truncate">{nameOf(screen.file)}</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function SwapItems({
	files,
	file,
	start,
	current,
	attributes,
	onSwap,
}: {
	files: ProjectFiles;
	file: string;
	start: number;
	current: string;
	attributes: string[];
	onSwap: (source: string, start: number) => void;
}) {
	const targets = projectComponents(files).flatMap(({ path, exports }) =>
		exports.flatMap((exp): (SwapTarget & { kept: number })[] => {
			if (path === file || exp.name === current) return [];
			const props = exp.props.map((prop) => prop.name);
			const extendsElement = !!exp.extendsElement;

			const kept = attributes.filter((name) => extendsElement || props.includes(name)).length;

			return [{ name: exp.name, path, props, acceptsChildren: exp.acceptsChildren, extendsElement, kept }];
		}),
	);

	const swap = (target: SwapTarget) => {
		const source = files[file];

		if (source === undefined) return;
		const result = swapComponent(source, file, start, target);

		if ("error" in result) {
			toast.error(`Couldn't swap ${current} for ${target.name}`, { description: result.error });

			return;
		}

		onSwap(result.source, result.start);
		toast(`Swapped ${current} for ${target.name}`, {
			description: result.dropped.length
				? `${target.name} doesn't take ${result.dropped.join(", ")}, so ${result.dropped.length === 1 ? "it was" : "they were"} left out. Press ⌘Z to undo.`
				: "Every prop carried over. Press ⌘Z to undo.",
		});
	};

	if (!targets.length) return <p className="px-2 py-1.5 text-xs text-subtle-foreground">No other components yet</p>;

	return targets.map((target) => (
		<DropdownMenuItem
			key={`${target.path}#${target.name}`}
			className="flex items-center gap-3 text-[13px]"
			onSelect={() => swap(target)}
		>
			<span className="min-w-0 flex-1 truncate">{target.name}</span>
			{attributes.length ? (
				<span className="shrink-0 text-[11px] text-subtle-foreground tabular-nums">
					keeps {target.kept} of {plural(attributes.length, "prop")}
				</span>
			) : null}
		</DropdownMenuItem>
	));
}

/** Figma's instance swap: another project component in its place, with the props both take */
export function ComponentSwapMenu(props: {
	files: ProjectFiles;
	file: string;
	start: number;
	current: string;
	/** Set on the usage */
	attributes: string[];
	disabled?: boolean;
	onSwap: (source: string, start: number) => void;
}) {
	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="xs"
					disabled={props.disabled}
					className="text-muted-foreground"
					title={`Swap ${props.current} for another component`}
				>
					<Replace />
					Swap
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-h-80 min-w-56">
				<DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
					Swap {props.current} for
				</DropdownMenuLabel>
				<SwapItems {...props} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
