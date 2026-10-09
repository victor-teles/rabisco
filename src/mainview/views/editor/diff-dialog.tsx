import { useEffect, useRef, useState } from "react";
import { PatchDiff } from "@pierre/diffs/react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ChangedFile } from "../../../shared/change-summary";
import { DiffStat } from "./change-summary";

type DiffStyle = "unified" | "split";

const isDiffStyle = (value: string): value is DiffStyle => value === "unified" || value === "split";

/** Every changed file's diff, stacked; opened on `focus` when a file was clicked */
export function DiffDialog({
	files,
	focus,
	additions,
	deletions,
	onClose,
}: {
	files: ChangedFile[];
	focus: string | null;
	additions: number;
	deletions: number;
	onClose: () => void;
}) {
	const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");
	const listRef = useRef<HTMLDivElement>(null);
	// The diff renders in its own shadow root, so it can't follow the `dark` class; it gets the app's theme instead
	const dark = document.documentElement.classList.contains("dark");

	useEffect(() => {
		if (!focus) return;

		const frame = requestAnimationFrame(() =>
			listRef.current?.querySelector(`[data-path="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "start" }),
		);

		return () => cancelAnimationFrame(frame);
	}, [focus]);

	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
			<DialogContent
				// The list, not the layout toggle, takes focus, so the arrow keys scroll the diff
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					listRef.current?.focus();
				}}
				className="flex h-[85vh] max-w-[min(1100px,calc(100%-2rem))] flex-col gap-0 p-0 sm:max-w-[min(1100px,calc(100%-2rem))]"
			>
				<div className="flex items-center gap-3 border-b py-3 pr-12 pl-4">
					<DialogTitle className="text-sm font-medium">
						{files.length === 1 ? "1 changed file" : `${files.length} changed files`}
					</DialogTitle>
					<DiffStat additions={additions} deletions={deletions} className="text-xs" />
					<DialogDescription className="sr-only">The lines this generation added and removed</DialogDescription>
					<ToggleGroup
						type="single"
						size="sm"
						variant="outline"
						value={diffStyle}
						onValueChange={(next) => (isDiffStyle(next) ? setDiffStyle(next) : undefined)}
						aria-label="Diff layout"
						className="ml-auto"
					>
						<ToggleGroupItem value="unified" className="h-7 px-2.5 text-xs">
							Unified
						</ToggleGroupItem>
						<ToggleGroupItem value="split" className="h-7 px-2.5 text-xs">
							Split
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
				<div ref={listRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
					{files.map((file) => (
						<div key={file.path} data-path={file.path} className="scroll-mt-0 border-b last:border-b-0">
							{file.patch ? (
								<PatchDiff
									patch={file.patch}
									options={{
										theme: { dark: "pierre-dark", light: "pierre-light" },
										themeType: dark ? "dark" : "light",
										diffStyle,
										lineDiffType: "word",
										overflow: "wrap",
										stickyHeader: true,
									}}
								/>
							) : (
								<p className="px-4 py-3 text-xs text-muted-foreground">
									<span className="font-mono text-foreground">{file.path}</span> · too large to show
								</p>
							)}
						</div>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
