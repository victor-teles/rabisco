import { useRef } from "react";
import { CircleAlert, CircleCheck, Copy, Sparkles, TriangleAlert } from "lucide-react";
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
import { DESIGN_RULE_LABELS, type DesignFinding } from "../../../shared/design/findings";
import { fixPrompt } from "../../../shared/design/fix-prompt";
import { screenNameFromPath } from "../../../shared/project";
import type { ElementRef } from "../../../shared/prototype/links";
import { designReport, type ScreenCheck } from "./design-check";

export type CheckKind = "design" | "accessibility" | "consistency";

const CHECKS: Record<CheckKind, { title: string; checked: string; copied: string; fix: string }> = {
	design: {
		title: "Design check",
		checked: "Checked overflow, clipped text, overlap, contrast, tokens and type scale.",
		copied: "Copied the design check as JSON",
		fix: "Fix these design problems:",
	},
	accessibility: {
		title: "Accessibility check",
		checked: "Checked labels, alt text, focus order, tap targets and landmarks.",
		copied: "Copied the accessibility check as JSON",
		fix: "Fix these accessibility problems. Keep the look the same:",
	},
	consistency: {
		title: "Consistency check",
		checked: "Compared components, page spacing and navigation across the screens.",
		copied: "Copied the consistency check as JSON",
		fix: "Make these screens consistent. Match what most screens do:",
	},
};

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const tally = (errors: number, warnings: number) =>
	[errors ? count(errors, "error") : "", warnings ? count(warnings, "warning") : ""].filter(Boolean).join(", ");

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
				<span className="text-xs font-medium">{DESIGN_RULE_LABELS[finding.rule]}</span>
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

/** Findings by screen; a click selects the element (or the screen) and closes the dialog. "Fix in chat" puts them in the composer as one prompt */
export function DesignCheckDialog({
	kind = "design",
	results,
	onSelect,
	onFix,
	onClose,
}: {
	kind?: CheckKind;
	results: ScreenCheck[];
	onSelect: (screen: string, element: ElementRef | null) => void;
	/** `screens` hold findings; `null` hides the button, as while a generation runs */
	onFix?: ((prompt: string, screens: string[]) => void) | null;
	onClose: () => void;
}) {
	const check = CHECKS[kind];
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
		toast.success(check.copied);
	};

	const fix = () => {
		const named = results.map(({ frame, findings }) => ({
			name: frame.name || screenNameFromPath(frame.file),
			findings,
		}));

		const screens = results.flatMap(({ frame, findings }) => (findings.length ? [frame.file] : []));

		onFix?.(fixPrompt(check.fix, named), screens);
		onClose();
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
					<DialogTitle className="text-sm font-medium">{check.title}</DialogTitle>
					<DialogDescription className="text-xs text-muted-foreground">
						{total ? tally(errors, warnings) : count(results.length, "screen")}
					</DialogDescription>
					<div className="ml-auto flex items-center gap-1">
						{onFix && total > 0 ? (
							<Button variant="ghost" size="xs" onClick={fix}>
								<Sparkles />
								Fix in chat
							</Button>
						) : null}
						<Button variant="ghost" size="xs" onClick={() => void copy()}>
							<Copy />
							Copy JSON
						</Button>
					</div>
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
									<EmptyStateDescription>{check.checked}</EmptyStateDescription>
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
