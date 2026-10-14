import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { imageFileNames, imageTargets, scaledFileName } from "../../../../shared/export/targets";
import { screenNameFromPath } from "../../../../shared/project";
import { EXPORT_SCALES, exportImages, type ImageExportInput, type ImageFormat } from "./image-export";

type Request = { input: ImageExportInput; format: ImageFormat };

const FORMATS: ImageFormat[] = ["png", "svg"];

const SHOWN_NAMES = 6;

let pending: Request | null = null;

/** The next dialog starts from the last scales used */
let lastScales: number[] = [2];

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
	listeners.add(listener);

	return () => void listeners.delete(listener);
};

function setPending(next: Request | null) {
	pending = next;

	for (const listener of listeners) listener();
}

/** Opens the dialog for the selected screens, or every screen without a selection */
export function askImageExport(input: ImageExportInput, format: ImageFormat = "png") {
	setPending({ input, format });
}

/** Mounted once in the editor; ⇧⌘E and the Export menu's image items open it */
export function ImageExportDialog() {
	const request = useSyncExternalStore(subscribe, () => pending);

	return (
		<Dialog open={request !== null} onOpenChange={(open) => !open && setPending(null)}>
			<DialogContent className="sm:max-w-sm">{request ? <ExportForm request={request} /> : null}</DialogContent>
		</Dialog>
	);
}

const isFormat = (value: string): value is ImageFormat => FORMATS.some((format) => format === value);

function ExportForm({ request }: { request: Request }) {
	const { input } = request;
	const [format, setFormat] = useState(request.format);
	const [scales, setScales] = useState(lastScales);
	const targets = imageTargets(input.frames, input.selected, input.files);
	const chosen = format === "png" ? scales : [1];

	const names = imageFileNames(
		targets.map((frame) => frame.file),
		format,
	).flatMap((name) => chosen.map((scale) => (chosen.length > 1 ? scaledFileName(name, scale) : name)));

	const subject =
		targets.length === 1 ? targets[0]!.name || screenNameFromPath(targets[0]!.file) : `${targets.length} screens`;

	const submit = (event: React.FormEvent) => {
		event.preventDefault();

		if (!names.length) return;

		if (format === "png") lastScales = scales;
		setPending(null);
		void exportImages(format, input, chosen);
	};

	return (
		<form onSubmit={submit} className="grid gap-4">
			<DialogHeader>
				<DialogTitle>Export {subject}</DialogTitle>
				<DialogDescription>Files are named after the screens.</DialogDescription>
			</DialogHeader>
			<div className="grid gap-3">
				<div className="grid gap-1.5">
					<span className="text-xs text-muted-foreground">Format</span>
					<ToggleGroup
						type="single"
						size="sm"
						variant="outline"
						value={format}
						onValueChange={(next) => isFormat(next) && setFormat(next)}
						aria-label="Format"
						className="w-full"
					>
						{FORMATS.map((option) => (
							<ToggleGroupItem key={option} value={option} className="h-8 flex-1 text-xs">
								{option.toUpperCase()}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>
				{format === "png" ? (
					<div className="grid gap-1.5">
						<span className="text-xs text-muted-foreground">Sizes</span>
						<ToggleGroup
							type="multiple"
							size="sm"
							variant="outline"
							value={scales.map(String)}
							onValueChange={(next) => setScales(EXPORT_SCALES.filter((scale) => next.includes(String(scale))))}
							aria-label="Sizes"
							className="w-full"
						>
							{EXPORT_SCALES.map((scale) => (
								<ToggleGroupItem key={scale} value={String(scale)} className="h-8 flex-1 text-xs tabular-nums">
									{scale}x
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</div>
				) : (
					<p className="text-xs text-muted-foreground">SVG scales without loss, so it has one size.</p>
				)}
				<ul className="grid gap-0.5 rounded-md bg-muted/50 px-2.5 py-2 font-mono text-xs text-muted-foreground">
					{names.length ? (
						names.slice(0, SHOWN_NAMES).map((name) => (
							<li key={name} className="truncate">
								{name}
							</li>
						))
					) : (
						<li>{targets.length ? "Pick at least one size" : "No screens to export"}</li>
					)}
					{names.length > SHOWN_NAMES ? <li>and {names.length - SHOWN_NAMES} more</li> : null}
				</ul>
			</div>
			<DialogFooter>
				<Button type="button" variant="ghost" onClick={() => setPending(null)}>
					Cancel
				</Button>
				<Button type="submit" disabled={!names.length}>
					Export…
				</Button>
			</DialogFooter>
		</form>
	);
}
