import { useRef } from "react";
import { CircleAlert, CircleCheck, Copy, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
	EmptyState,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateMedia,
	EmptyStateTitle,
} from "@/components/ui/uai/empty-state";
import { cn } from "@/lib/utils";
import type { DesignFinding, DesignRule } from "../../../shared/design/findings";
import { screenNameFromPath } from "../../../shared/project";
import type { ElementRef } from "../../../shared/prototype/links";
import { designReport, type ScreenCheck } from "./design-check";

const RULE_LABELS: Record<DesignRule, string> = {
	"frame-overflow": "Wider than the screen",
	"text-clipped": "Clipped text",
	overlap: "Overlap",
	contrast: "Low contrast",
	"raw-color": "Color without a token",
	"empty-container": "Empty container",
	"font-sizes": "Too many font sizes",
};

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function summaryOf(results: ScreenCheck[]) {
	const all = results.flatMap((result) => result.findings);
	const errors = all.filter((finding) => finding.severity === "error").length;

	return { total: all.length, errors, warnings: all.length - errors };
}

function FindingRow({ finding, onSelect }: { finding: DesignFinding; onSelect: () => void }) {
	const Icon = finding.severity === "error" ? CircleAlert : TriangleAlert;

	return (
		<button
			type="button"
			onClick={onSelect}
			className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
		>
			<Icon
				className={cn(
					"mt-0.5 size-3.5 shrink-0",
					finding.severity === "error" ? "text-destructive" : "text-muted-foreground",
				)}
			/>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="text-xs font-medium">{RULE_LABELS[finding.rule]}</span>
				<span className="text-xs text-muted-foreground">{finding.message}</span>
			</span>
			{finding.path && (
				<span className="shrink-0 font-mono text-[11px] text-muted-foreground">
					{finding.path.split("/").pop()}
					{finding.line ? `:${finding.line}` : ""}
				</span>
			)}
		</button>
	);
}

/** Findings by screen; a click selects the element (or the screen) and closes the dialog */
export function DesignCheckDialog({
	results,
	onSelect,
	onClose,
}: {
	results: ScreenCheck[];
	onSelect: (screen: string, element: ElementRef | null) => void;
	onClose: () => void;
}) {
	const { total, errors, warnings } = summaryOf(results);
	const listRef = useRef<HTMLDivElement>(null);

	const select = (screen: string, finding: DesignFinding) => {
		// Findings in a component's file can't be selected from the screen that renders it
		const element =
			finding.path === screen && finding.start !== undefined ? { file: screen, start: finding.start } : null;

		onSelect(screen, element);
		onClose();
	};

	const copy = async () => {
		await navigator.clipboard.writeText(JSON.stringify(designReport(results), null, "\t"));
		toast.success("Copied the design check as JSON");
	};

	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
			<DialogContent
				// The list, not Copy JSON, takes focus, so Tab walks the findings and the arrow keys scroll
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					listRef.current?.focus();
				}}
				className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-xl"
			>
				<div className="flex items-center gap-3 border-b py-3 pr-12 pl-4">
					<DialogTitle className="text-sm font-medium">Design check</DialogTitle>
					<DialogDescription className="text-xs text-muted-foreground">
						{total ? `${count(errors, "error")}, ${count(warnings, "warning")}` : count(results.length, "screen")}
					</DialogDescription>
					<Button variant="ghost" size="xs" className="ml-auto" onClick={() => void copy()}>
						<Copy />
						Copy JSON
					</Button>
				</div>
				<div ref={listRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto p-2 outline-none">
					{total === 0 && results.every((result) => !result.error) ? (
						<EmptyState variant="plain">
							<EmptyStateMedia>
								<CircleCheck />
							</EmptyStateMedia>
							<EmptyStateContent>
								<EmptyStateHeader>
									<EmptyStateTitle>No problems found</EmptyStateTitle>
									<EmptyStateDescription>
										Checked overflow, clipped text, overlap, contrast, tokens and type scale.
									</EmptyStateDescription>
								</EmptyStateHeader>
							</EmptyStateContent>
						</EmptyState>
					) : (
						results.map(({ frame, findings, error }) =>
							findings.length || error ? (
								<section key={frame.file} className="flex flex-col pb-2">
									<h3 className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">
										{frame.name || screenNameFromPath(frame.file)}
									</h3>
									{error && <p className="px-2 pb-1 text-xs text-destructive">Didn't render: {error}</p>}
									{findings.map((finding, i) => (
										<FindingRow
											key={`${finding.rule}-${finding.start ?? i}-${i}`}
											finding={finding}
											onSelect={() => select(frame.file, finding)}
										/>
									))}
								</section>
							) : null,
						)
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
