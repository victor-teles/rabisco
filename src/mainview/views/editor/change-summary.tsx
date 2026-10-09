import { lazy, Suspense, useMemo, useState } from "react";
import {
	ChevronRight,
	ChevronsDownUp,
	ChevronsUpDown,
	File,
	FileCode,
	FileDiff,
	FileText,
	Folder,
	FolderOpen,
	Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ChangeTreeNode, changeTree, folderPaths } from "@/lib/change-tree";
import { cn } from "@/lib/utils";
import type { ChangedFile, ChangeSummary } from "../../../shared/change-summary";

// Shiki and the diff renderer are large; load them the first time a diff opens
const DiffDialog = lazy(() => import("./diff-dialog").then((module) => ({ default: module.DiffDialog })));

export function DiffStat({
	additions,
	deletions,
	className,
}: {
	additions: number;
	deletions: number;
	className?: string;
}) {
	return (
		<span className={cn("flex shrink-0 gap-1.5 font-mono text-[11.5px] tabular-nums", className)}>
			{additions ? <span className="text-success">+{additions}</span> : null}
			{deletions ? <span className="text-destructive">-{deletions}</span> : null}
		</span>
	);
}

function fileIcon(path: string) {
	if (/\.(tsx?|jsx?|css)$/.test(path)) return FileCode;

	return path.endsWith(".md") ? FileText : File;
}

const INDENT = 14;

function TreeRows({
	nodes,
	depth,
	collapsed,
	onToggle,
	onOpenFile,
}: {
	nodes: ChangeTreeNode[];
	depth: number;
	collapsed: ReadonlySet<string>;
	onToggle: (path: string) => void;
	onOpenFile: (file: ChangedFile) => void;
}) {
	const row =
		"flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring";

	return nodes.map((node) => {
		const padding = { paddingLeft: 6 + depth * INDENT };

		if (node.kind === "file") {
			const Icon = fileIcon(node.file.path);
			const deleted = node.file.change === "deleted";

			return (
				<li key={node.file.path}>
					<button
						type="button"
						className={row}
						style={padding}
						onClick={() => onOpenFile(node.file)}
						title={`${node.file.path} · ${node.file.change}`}
					>
						<span className="size-3.5 shrink-0" />
						<Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
						<span
							className={cn(
								"min-w-0 flex-1 truncate font-mono text-[12px]",
								deleted ? "text-subtle-foreground line-through" : "text-muted-foreground",
							)}
						>
							{node.name}
						</span>
						<DiffStat additions={node.file.additions} deletions={node.file.deletions} />
					</button>
				</li>
			);
		}

		const open = !collapsed.has(node.path);
		const Icon = open ? FolderOpen : Folder;

		return (
			<li key={node.path}>
				<button type="button" className={row} style={padding} aria-expanded={open} onClick={() => onToggle(node.path)}>
					<ChevronRight
						className={cn("size-3.5 shrink-0 text-subtle-foreground transition-transform", open && "rotate-90")}
					/>
					<Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
					<span className="min-w-0 flex-1 truncate font-mono text-[12px]">{node.name}</span>
					<DiffStat additions={node.additions} deletions={node.deletions} />
				</button>
				{open ? (
					<ul>
						<TreeRows
							nodes={node.children}
							depth={depth + 1}
							collapsed={collapsed}
							onToggle={onToggle}
							onOpenFile={onOpenFile}
						/>
					</ul>
				) : null}
			</li>
		);
	});
}

/** What a generation changed, under its reply: a file tree with line counts, the diff, and Undo while it is the latest step */
export function ChangeSummaryCard({ summary, onUndo }: { summary: ChangeSummary; onUndo?: () => void }) {
	const tree = useMemo(() => changeTree(summary.files), [summary.files]);
	const folders = useMemo(() => folderPaths(tree), [tree]);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const [diff, setDiff] = useState<{ focus: string | null } | null>(null);

	const count = summary.files.length;
	const additions = summary.files.reduce((sum, file) => sum + file.additions, 0);
	const deletions = summary.files.reduce((sum, file) => sum + file.deletions, 0);
	const allCollapsed = folders.length > 0 && folders.every((path) => collapsed.has(path));
	const viewable = summary.files.some((file) => file.patch);

	const toggle = (path: string) =>
		setCollapsed((current) => {
			const next = new Set(current);

			if (!next.delete(path)) next.add(path);

			return next;
		});

	return (
		<section aria-label="Changed files" className="@container rounded-xl border bg-card/60 text-[13px]">
			<div className="flex min-h-10 items-center gap-2 pr-1.5 pl-3">
				<h3 className="shrink-0 font-medium whitespace-nowrap">
					{count === 1 ? "1 changed file" : count ? `${count} changed files` : "No files changed"}
				</h3>
				<DiffStat additions={additions} deletions={deletions} className="text-xs" />
				{summary.problems ? (
					<span className="truncate text-xs text-warning">
						{summary.problems === 1 ? "1 problem left" : `${summary.problems} problems left`}
					</span>
				) : null}
				<span className="ml-auto flex shrink-0 items-center gap-0.5">
					{folders.length ? (
						<Button
							variant="ghost"
							size="icon-xs"
							className="text-muted-foreground"
							aria-label={allCollapsed ? "Expand all folders" : "Collapse all folders"}
							title={allCollapsed ? "Expand all" : "Collapse all"}
							onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(folders))}
						>
							{allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
						</Button>
					) : null}
					{viewable ? (
						<Button variant="ghost" size="xs" aria-label="Open diff" onClick={() => setDiff({ focus: null })}>
							<FileDiff />
							{/* A narrow chat panel keeps the icon, so the title stays on one line */}
							<span className="hidden @sm:inline">Open diff</span>
						</Button>
					) : null}
					{onUndo ? (
						<Button variant="ghost" size="xs" onClick={onUndo}>
							<Undo2 />
							Undo
						</Button>
					) : null}
				</span>
			</div>
			{count ? (
				<ul className="px-1.5 pb-1.5">
					<TreeRows
						nodes={tree}
						depth={0}
						collapsed={collapsed}
						onToggle={toggle}
						onOpenFile={(file) => setDiff({ focus: file.path })}
					/>
				</ul>
			) : null}
			{diff ? (
				<Suspense fallback={null}>
					<DiffDialog
						files={summary.files}
						focus={diff.focus}
						additions={additions}
						deletions={deletions}
						onClose={() => setDiff(null)}
					/>
				</Suspense>
			) : null}
		</section>
	);
}
