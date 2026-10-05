import { useMemo, useRef, useState } from "react";
import { FileText, FolderInput, MessageSquareText, MoreHorizontal, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, isDesktop } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { contextBody } from "../../../shared/context/body";
import { CONTEXT_TEMPLATES } from "../../../shared/context/templates";
import { COLOR_TOKENS, parseDesignTokens, TOKEN_NAMES } from "../../../shared/context/tokens";
import type { ContextFileName, ProjectFiles } from "../../../shared/types";

export const CONTEXT_FILES: ContextFileName[] = ["PRODUCT.md", "DESIGN.md"];

const isContextFileName = (value: string): value is ContextFileName => CONTEXT_FILES.some((name) => name === value);

type ImportedFile = { path: ContextFileName; content: string; source: string };

export type ContextPanelProps = {
	files: ProjectFiles;
	file: ContextFileName;
	onFileChange: (file: ContextFileName) => void;
	/** `step` groups the edits of one focus into a single undo step */
	onEdit: (file: ContextFileName, text: string, step: string) => void;
	/** Several files as one undo step (templates, imports) */
	onReplace: (files: Partial<Record<ContextFileName, string>>) => void;
	onEndStep: () => void;
	onUndo: () => void;
	onRedo: () => void;
	/** Context files the latest generation followed; null before the first one */
	lastUsed: ContextFileName[] | null;
	hasScreens: boolean;
	/** A generation or the interview is running */
	busy: boolean;
	onWriteDesign: () => void;
	onInterview: () => void;
};

const DESCRIPTION: Record<ContextFileName, string> = {
	"PRODUCT.md": "What the product is, who it's for, how it sounds and what it must respect.",
	"DESIGN.md": "Tokens, typography, layout and component rules. Tokens re-theme every screen.",
};

/**
 * PRODUCT.md and DESIGN.md (principle 5): edit them, write them with the AI or
 * import them from a repository, and see whether the last generation used them.
 * The text comes straight from the project files, so external edits show up live.
 */
export function ContextPanel(props: ContextPanelProps) {
	const { files, file, onFileChange, onEdit, onReplace, onEndStep, onUndo, onRedo, lastUsed } = props;
	const source = files[file];
	const textarea = useRef<HTMLTextAreaElement>(null);
	const focusId = useRef(0);
	const [pendingImport, setPendingImport] = useState<ImportedFile[] | null>(null);

	const applyImport = (found: ImportedFile[]) => {
		setPendingImport(null);
		onReplace(Object.fromEntries(found.map((f) => [f.path, f.content])));

		if (!found.some((f) => f.path === file)) onFileChange(found[0]!.path);
		toast(`Imported ${found.map((f) => `${f.path} from ${f.source}`).join(" and ")}`);
	};

	const importFromRepository = async () => {
		if (!isDesktop) {
			toast("Import needs the desktop app");

			return;
		}

		const from = await api.pickProjectFolder({});

		if (!from) return;
		let found: ImportedFile[];

		try {
			found = (await api.importContext({ from })).files;
		} catch (reason) {
			toast.error("Couldn't import", { description: reason instanceof Error ? reason.message : String(reason) });

			return;
		}

		if (!found.length) {
			toast("No PRODUCT.md or DESIGN.md in that folder", {
				description: "Rabisco looks in the folder itself and in docs/.",
			});

			return;
		}

		// Only ask when real work would be replaced; templates and identical files are fine to overwrite
		const overwrites = found.filter((f) => contextBody(files[f.path]) !== undefined && files[f.path] !== f.content);

		if (overwrites.length) setPendingImport(found);
		else applyImport(found);
	};

	const missing = source === undefined;
	const actions = <ContextActions {...props} missing={missing} onImport={importFromRepository} />;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-10 shrink-0 items-center gap-2 border-b pr-2 pl-3">
				<ToggleGroup
					type="single"
					size="sm"
					value={file}
					onValueChange={(next) => {
						if (isContextFileName(next)) onFileChange(next);
					}}
					aria-label="Context file"
					className="h-7"
				>
					{CONTEXT_FILES.map((name) => (
						<ToggleGroupItem key={name} value={name} className="h-7 px-2 font-mono text-xs">
							{name}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				<div className="flex-1" />
				{missing ? null : actions}
			</div>

			{missing ? (
				<MissingFile {...props} onImport={importFromRepository} />
			) : (
				<>
					<UsageLine file={file} source={source} lastUsed={lastUsed} />
					{file === "DESIGN.md" ? (
						<TokenSummary
							markdown={source}
							onJumpToLine={(line) => {
								const element = textarea.current;

								if (!element) return;

								const start =
									source
										.split("\n")
										.slice(0, line - 1)
										.join("\n").length + (line > 1 ? 1 : 0);

								const end = source.indexOf("\n", start);
								element.focus();
								element.setSelectionRange(start, end === -1 ? source.length : end);
							}}
						/>
					) : null}
					<textarea
						ref={textarea}
						value={source}
						aria-label={`${file} contents`}
						spellCheck={false}
						onFocus={() => {
							focusId.current += 1;
						}}
						onBlur={onEndStep}
						onChange={(event) => onEdit(file, event.target.value, `context:${file}:${focusId.current}`)}
						onKeyDown={(event) => {
							// The project history owns undo, so it matches the rest of the editor
							const mod = event.metaKey || event.ctrlKey;

							if (mod && (event.code === "KeyZ" || event.code === "KeyY")) {
								event.preventDefault();
								onEndStep();

								if (event.code === "KeyY" || event.shiftKey) onRedo();
								else onUndo();
								focusId.current += 1;
							} else if (event.key === "Escape") event.currentTarget.blur();
						}}
						className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-xs/5 outline-none"
						style={{ tabSize: 2 }}
					/>
				</>
			)}

			<Dialog open={pendingImport !== null} onOpenChange={(open) => !open && setPendingImport(null)}>
				<DialogContent className="sm:max-w-sm" showCloseButton={false}>
					<DialogHeader>
						<DialogTitle className="text-base">Replace your context files?</DialogTitle>
						<DialogDescription className="text-[13px]">
							{pendingImport
								?.filter((f) => contextBody(files[f.path]) !== undefined && files[f.path] !== f.content)
								.map((f) => f.path)
								.join(" and ")}{" "}
							already {pendingImport && pendingImport.length > 1 ? "have" : "has"} content. You can undo the import.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" size="sm" onClick={() => setPendingImport(null)}>
							Cancel
						</Button>
						<Button size="sm" onClick={() => pendingImport && applyImport(pendingImport)} autoFocus>
							Replace
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

/** The AI action for a file: writing DESIGN.md needs screens, PRODUCT.md comes from an interview. */
function aiAction({ file, hasScreens, busy, onWriteDesign, onInterview }: ContextPanelProps) {
	return file === "DESIGN.md"
		? {
				label: "Write from my screens",
				icon: Wand2,
				disabled: busy || !hasScreens,
				hint: hasScreens ? undefined : "Design a screen first; DESIGN.md is inferred from your screens.",
				run: onWriteDesign,
			}
		: { label: "Interview me", icon: MessageSquareText, disabled: busy, hint: undefined, run: onInterview };
}

function ContextActions(props: ContextPanelProps & { missing: boolean; onImport: () => void }) {
	const { file, files, onReplace, onImport } = props;
	const ai = aiAction(props);
	// Resetting to the template would throw work away; only offer it while the file says nothing yet
	const canUseTemplate = contextBody(files[file]) === undefined && files[file] !== CONTEXT_TEMPLATES[file];

	return (
		<DropdownMenu modal={false}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon-xs" aria-label={`${file} actions`}>
							<MoreHorizontal />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">Write or import</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end" className="min-w-56">
				<DropdownMenuItem className="text-[13px]" disabled={ai.disabled} onSelect={ai.run}>
					<ai.icon />
					<span className="flex flex-col">
						{ai.label}
						{ai.hint ? <span className="text-xs text-subtle-foreground">{ai.hint}</span> : null}
					</span>
				</DropdownMenuItem>
				{canUseTemplate ? (
					<DropdownMenuItem className="text-[13px]" onSelect={() => onReplace({ [file]: CONTEXT_TEMPLATES[file] })}>
						<FileText />
						Start from template
					</DropdownMenuItem>
				) : null}
				<DropdownMenuSeparator />
				<DropdownMenuItem className="text-[13px]" onSelect={onImport}>
					<FolderInput />
					Import from a repository…
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function MissingFile(props: ContextPanelProps & { onImport: () => void }) {
	const { file, onReplace, onImport } = props;
	const ai = aiAction(props);

	return (
		<div className="flex flex-col gap-4 p-4">
			<div>
				<p className="text-[13px] font-medium">No {file} yet</p>
				<p className="mt-1 text-[13px]/5 text-muted-foreground">{DESCRIPTION[file]} Every generation follows it.</p>
			</div>
			<div className="flex flex-col items-start gap-2">
				<Button size="sm" onClick={() => onReplace({ [file]: CONTEXT_TEMPLATES[file] })}>
					<FileText />
					Start from template
				</Button>
				<Button variant="outline" size="sm" disabled={ai.disabled} onClick={ai.run}>
					<ai.icon />
					{ai.label}
				</Button>
				{ai.hint ? <p className="-mt-1 text-xs text-subtle-foreground">{ai.hint}</p> : null}
				<Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={onImport}>
					<FolderInput />
					Import from a repository…
				</Button>
			</div>
		</div>
	);
}

/** Whether the file shaped the last generation, or why it won't shape the next one. */
function UsageLine({
	file,
	source,
	lastUsed,
}: {
	file: ContextFileName;
	source: string;
	lastUsed: ContextFileName[] | null;
}) {
	const template = contextBody(source) === undefined;
	const used = !template && lastUsed?.includes(file);

	const label = template
		? "Template — not used until you fill it in"
		: used
			? "Used in the last generation"
			: "Not used yet";

	return (
		<div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1 text-xs text-subtle-foreground">
			<span
				aria-hidden
				className={cn(
					"size-1.5 shrink-0 rounded-full",
					used ? "bg-emerald-500" : template ? "border border-subtle-foreground/60" : "bg-subtle-foreground/50",
				)}
			/>
			{label}
		</div>
	);
}

/** Parsed tokens at a glance, so a typo in a value or name is visible before the next generation. */
function TokenSummary({ markdown, onJumpToLine }: { markdown: string; onJumpToLine: (line: number) => void }) {
	const tokens = useMemo(() => parseDesignTokens(markdown), [markdown]);
	const colorNames = new Set<string>(COLOR_TOKENS);

	const entries = TOKEN_NAMES.filter((name) => name in tokens.light).map(
		(name) => [name, tokens.light[name]!] as const,
	);

	const colors = entries.filter(([name]) => colorNames.has(name));
	const others = entries.filter(([name]) => !colorNames.has(name));
	const darkCount = Object.keys(tokens.dark).length;

	if (!entries.length && !darkCount && !tokens.invalid.length) return null;

	return (
		<div className="flex shrink-0 flex-col gap-2 border-b px-4 pt-2 pb-3">
			{colors.length ? (
				<div className="flex flex-wrap items-center gap-1" aria-label="Color tokens">
					{colors.map(([name, value]) => (
						<Tooltip key={name}>
							<TooltipTrigger asChild>
								<span
									className="size-4 rounded-[4px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
									style={{ background: value }}
									aria-label={`${name}: ${value}`}
									role="img"
								/>
							</TooltipTrigger>
							<TooltipContent side="bottom" className="font-mono text-[11px]">
								{name}: {value}
							</TooltipContent>
						</Tooltip>
					))}
					{darkCount ? <span className="ml-1 text-[11px] text-subtle-foreground">+ {darkCount} dark</span> : null}
				</div>
			) : null}
			{others.length ? (
				<div className="flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
					{others.map(([name, value]) => (
						<span key={name} className="truncate" title={`${name}: ${value}`}>
							<span className="text-subtle-foreground">{name}</span> {value}
						</span>
					))}
				</div>
			) : null}
			{tokens.invalid.length ? (
				<ul className="flex flex-col gap-0.5" aria-label="Tokens that were ignored">
					{tokens.invalid.map((token) => (
						<li key={`${token.line}:${token.name}`}>
							<button
								type="button"
								onClick={() => onJumpToLine(token.line)}
								className="w-full rounded text-left line-clamp-2 text-[11px]/4 text-pretty text-destructive hover:underline"
								title={`${token.name}: ${token.value} — ${token.reason}`}
							>
								<span className="tabular-nums">Line {token.line}</span> ·{" "}
								<span className="font-mono">{token.name}</span> ignored: {token.reason}
							</button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
