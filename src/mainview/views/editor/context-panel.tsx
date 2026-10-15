import { useMemo, useRef, useState } from "react";
import {
	FileText,
	FolderInput,
	Import,
	Image,
	MessageSquareText,
	MoreHorizontal,
	Plus,
	SwatchBook,
	Wand2,
	X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
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
import {
	EmptyState,
	EmptyStateAction,
	EmptyStateActions,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateMedia,
	EmptyStateNote,
	EmptyStateTitle,
} from "@/components/ui/uai/empty-state";
import { api, isDesktop } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { logoPalette } from "../../../shared/context/brand-kit";
import { contextBody } from "../../../shared/context/body";
import { CONTEXT_TEMPLATES } from "../../../shared/context/templates";
import { normalizeTokenName, renameError, type TokenEdit, type TokenMode } from "../../../shared/context/token-edit";
import {
	contestedTokenNames,
	designTokensOf,
	isCustomToken,
	orderedTokenNames,
	parseDesignTokens,
	tokenClass,
	tokenKind,
	validateToken,
	type DesignTokens,
	type TokenModeGroup,
} from "../../../shared/context/tokens";
import { groupLabel, optionLabel } from "../../../shared/modes";
import { MAX_CONTEXT_FILE_BYTES } from "../../../shared/project";
import type { ContextFileName, ProjectFiles } from "../../../shared/types";
import { BrandImportDialog, logoPixels, type BrandImport } from "./brand-import-dialog";
import { DESIGN_SYSTEM_KEYS } from "./shortcuts";
import { AddTokenForm, ROW, TokenField } from "./token-fields";

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
	/** One undo step that writes DESIGN.md and applies its tokens to the screens */
	onEditToken: (edit: TokenEdit) => void;
	onOpenDesignSystem: () => void;
	/** One undo step that writes the tokens into DESIGN.md and applies them to the screens */
	onImportTokens: (tokens: DesignTokens) => void;
	/** One undo step that replaces DESIGN.md and applies its tokens, if it has any */
	onReplaceDesign: (markdown: string) => void;
	onUndo: () => void;
	onRedo: () => void;
	/** `null` before the first generation */
	lastUsed: ContextFileName[] | null;
	hasScreens: boolean;
	busy: boolean;
	/** Why the AI actions are off while `busy` */
	busyReason?: string;
	onWriteDesign: () => void;
	onInterview: () => void;
};

const DESCRIPTION: Record<ContextFileName, string> = {
	"PRODUCT.md": "What the product is, who it's for, how it sounds and what it must respect.",
	"DESIGN.md": "Tokens, typography, layout and component rules. Rabisco asks before new tokens re-theme the screens.",
};

/** Text comes straight from the project files, so external edits show up live */
export function ContextPanel(props: ContextPanelProps) {
	const { files, file, onFileChange, onEdit, onReplace, onEndStep, onEditToken, onUndo, onRedo, lastUsed } = props;
	const source = files[file];
	const textarea = useRef<HTMLTextAreaElement>(null);
	const logoInput = useRef<HTMLInputElement>(null);
	const focusId = useRef(0);
	const [pendingImport, setPendingImport] = useState<ImportedFile[] | null>(null);
	const [brandImport, setBrandImport] = useState<BrandImport | null>(null);
	const designTokens = useMemo(() => designTokensOf(files["DESIGN.md"]), [files]);

	const readLogo = async (logo: File) => {
		let palette: ReturnType<typeof logoPalette>;

		try {
			palette = logoPalette(await logoPixels(logo));
		} catch {
			toast.error(`Couldn't read ${logo.name}`, { description: "Pick a PNG, JPG, SVG or WebP image." });

			return;
		}

		if (!palette) {
			toast(`No colors in ${logo.name}`, { description: "The image is blank or white." });

			return;
		}

		setBrandImport({ kind: "logo", palette, image: URL.createObjectURL(logo), name: logo.name });
	};

	const brandActions = {
		onImportUrl: () => setBrandImport({ kind: "import" }),
		onImportLogo: () => logoInput.current?.click(),
	};

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
		let tooLarge: string[];

		try {
			({ files: found, tooLarge } = await api.importContext({ from }));
		} catch (reason) {
			toast.error("Couldn't import", { description: reason instanceof Error ? reason.message : String(reason) });

			return;
		}

		if (tooLarge.length) {
			toast(
				`${tooLarge.join(" and ")} ${tooLarge.length > 1 ? "are" : "is"} over ${MAX_CONTEXT_FILE_BYTES / 1024} KB`,
				{
					description: `Rabisco imports context files up to ${MAX_CONTEXT_FILE_BYTES / 1024} KB.`,
				},
			);
		}

		if (!found.length) {
			if (!tooLarge.length) {
				toast("No PRODUCT.md or DESIGN.md in that folder", {
					description: "Rabisco looks in the folder, docs/, doc/, design/, .github/ and .rabisco/.",
				});
			}

			return;
		}

		// Only ask when real work would be replaced; templates and identical files are fine to overwrite
		const overwrites = found.filter((f) => contextBody(files[f.path]) !== undefined && files[f.path] !== f.content);

		if (overwrites.length) setPendingImport(found);
		else applyImport(found);
	};

	const missing = source === undefined;
	const actions = <ContextActions {...props} {...brandActions} missing={missing} onImport={importFromRepository} />;

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
				<MissingFile {...props} {...brandActions} onImport={importFromRepository} />
			) : (
				<>
					<UsageLine file={file} source={source} lastUsed={lastUsed} />
					{file === "DESIGN.md" ? (
						<TokenEditor
							markdown={source}
							onEditToken={onEditToken}
							onOpenDesignSystem={props.onOpenDesignSystem}
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

			<input
				ref={logoInput}
				type="file"
				accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif,image/avif"
				className="hidden"
				tabIndex={-1}
				aria-hidden
				onChange={(event) => {
					const logo = event.target.files?.[0];
					event.target.value = "";

					if (logo) void readLogo(logo);
				}}
			/>
			<BrandImportDialog
				request={brandImport}
				current={designTokens}
				onClose={() => {
					if (brandImport?.kind === "logo") URL.revokeObjectURL(brandImport.image);
					setBrandImport(null);
				}}
				onApplyTokens={(tokens) => {
					props.onImportTokens(tokens);
					onFileChange("DESIGN.md");
				}}
				onReplaceDesign={(markdown) => {
					props.onReplaceDesign(markdown);
					onFileChange("DESIGN.md");
				}}
			/>
			<Dialog open={pendingImport !== null} onOpenChange={(open) => !open && setPendingImport(null)}>
				<DialogContent className="sm:max-w-sm" showCloseButton={false}>
					<DialogHeader>
						<DialogTitle className="text-base">Replace your context files?</DialogTitle>
						<DialogDescription className="text-[13px]">
							{pendingImport
								?.filter((f) => contextBody(files[f.path]) !== undefined && files[f.path] !== f.content)
								.map((f) => f.path)
								.join(" and ")}{" "}
							will be replaced. You can undo the import.
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

/** Writing DESIGN.md needs screens; PRODUCT.md comes from an interview */
function aiAction({ file, hasScreens, busy, busyReason, onWriteDesign, onInterview }: ContextPanelProps) {
	const busyHint = busy ? busyReason : undefined;

	return file === "DESIGN.md"
		? {
				label: "Write from my screens",
				icon: Wand2,
				disabled: busy || !hasScreens,
				hint: hasScreens ? busyHint : "Design a screen first; DESIGN.md is inferred from your screens.",
				run: onWriteDesign,
			}
		: { label: "Interview me", icon: MessageSquareText, disabled: busy, hint: busyHint, run: onInterview };
}

type BrandActions = { onImportUrl: () => void; onImportLogo: () => void };

function ContextActions(props: ContextPanelProps & BrandActions & { missing: boolean; onImport: () => void }) {
	const { file, files, onReplace, onImport, onImportUrl, onImportLogo } = props;
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
				{file === "DESIGN.md" ? (
					<>
						<DropdownMenuItem className="text-[13px]" onSelect={onImportUrl}>
							<Import />
							Import tokens…
						</DropdownMenuItem>
						<DropdownMenuItem className="text-[13px]" onSelect={onImportLogo}>
							<Image />
							Colors from a logo…
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function MissingFile(props: ContextPanelProps & BrandActions & { onImport: () => void }) {
	const { file, onReplace, onImport, onImportUrl } = props;
	const ai = aiAction(props);

	return (
		<div className="p-4">
			<EmptyState variant="compact">
				<EmptyStateMedia>
					<FileText />
				</EmptyStateMedia>
				<EmptyStateContent>
					<EmptyStateHeader>
						<EmptyStateTitle>No {file} yet</EmptyStateTitle>
						<EmptyStateDescription>{DESCRIPTION[file]} Every generation follows it.</EmptyStateDescription>
					</EmptyStateHeader>
					<EmptyStateActions>
						<EmptyStateAction onClick={() => onReplace({ [file]: CONTEXT_TEMPLATES[file] })}>
							<FileText />
							Start from template
						</EmptyStateAction>
						<EmptyStateAction emphasis="secondary" disabled={ai.disabled} onClick={ai.run}>
							<ai.icon />
							{ai.label}
						</EmptyStateAction>
						<EmptyStateAction emphasis="secondary" onClick={onImport}>
							<FolderInput />
							Import from a repository…
						</EmptyStateAction>
						{file === "DESIGN.md" ? (
							<EmptyStateAction emphasis="secondary" onClick={onImportUrl}>
								<Import />
								Import tokens…
							</EmptyStateAction>
						) : null}
					</EmptyStateActions>
					{ai.hint ? <EmptyStateNote>{ai.hint}</EmptyStateNote> : null}
				</EmptyStateContent>
			</EmptyState>
		</div>
	);
}

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

const TOKEN_MODES: TokenMode[] = ["light", "dark"];

const isBuiltInColor = (name: string) => tokenKind(name) === "color" && !isCustomToken(name);

/** What a screen uses when the mode has no value */
function fallbackLabel(name: string, mode: TokenMode) {
	if (isBuiltInColor(name)) return "Theme";

	return mode === "dark" ? "Same" : "None";
}

function TokenEditor({
	markdown,
	onEditToken,
	onOpenDesignSystem,
	onJumpToLine,
}: {
	markdown: string;
	onEditToken: (edit: TokenEdit) => void;
	onOpenDesignSystem: () => void;
	onJumpToLine: (line: number) => void;
}) {
	const parsed = useMemo(() => parseDesignTokens(markdown), [markdown]);
	const hasContent = useMemo(() => contextBody(markdown) !== undefined, [markdown]);
	const [adding, setAdding] = useState(false);
	const tokens = { light: parsed.light, dark: parsed.dark };
	const names = orderedTokenNames(tokens.light, tokens.dark);

	return (
		<div className="flex max-h-80 shrink-0 flex-col border-b pb-2">
			<div className="flex h-8 shrink-0 items-center gap-2 pr-2 pl-4">
				<span className="text-xs font-medium text-muted-foreground">Tokens</span>
				{names.length ? <span className="text-[11px] text-subtle-foreground tabular-nums">{names.length}</span> : null}
				<div className="flex-1" />
				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="ghost" size="icon-xs" aria-label="Open design system" onClick={onOpenDesignSystem}>
							<SwatchBook />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						Design system <Kbd>{DESIGN_SYSTEM_KEYS}</Kbd>
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label="Add token"
							aria-pressed={adding}
							onClick={() => setAdding((open) => !open)}
						>
							<Plus />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">Add token</TooltipContent>
				</Tooltip>
			</div>

			{names.length || parsed.modes || adding ? (
				<div
					className={cn(ROW, "shrink-0 px-2 pb-0.5 text-[10px] font-medium text-subtle-foreground uppercase")}
					aria-hidden
				>
					<span className="px-1.5">Name</span>
					<span className="px-1.5">Light</span>
					<span className="px-1.5">Dark</span>
				</div>
			) : null}

			<div className="flex min-h-0 flex-col overflow-y-auto px-2" aria-label="Design tokens" role="list">
				{names.map((name) => (
					<TokenRow key={name} name={name} tokens={tokens} onEditToken={onEditToken} />
				))}
				{adding ? (
					<AddTokenForm
						tokens={tokens}
						onAdd={(edit) => {
							onEditToken(edit);
							setAdding(false);
						}}
						onClose={() => setAdding(false)}
					/>
				) : null}
				{parsed.modes ? <ModeGroups groups={parsed.modes} /> : null}
			</div>

			{!names.length && !parsed.modes && !adding && hasContent ? (
				// Any format works: the theme is read with AI, on request (decision 0009)
				<div className="px-4 pt-1">
					<EmptyState variant="compact" aria-label="No tokens">
						<EmptyStateContent>
							<EmptyStateDescription>
								Rabisco reads the theme from this file with AI and asks before it re-themes the screens. A{" "}
								<span className="font-mono">## Tokens</span> section, if there is one, is used as it is.
							</EmptyStateDescription>
						</EmptyStateContent>
					</EmptyState>
				</div>
			) : null}

			{parsed.invalid.length ? (
				<ul className="flex shrink-0 flex-col gap-0.5 px-4 pt-2" aria-label="Tokens that were ignored">
					{parsed.invalid.map((token) => (
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

function ModeGroups({ groups }: { groups: TokenModeGroup[] }) {
	const contested = contestedTokenNames(groups);

	return (
		<div className="flex flex-col gap-2 pt-2 pb-1" aria-label="Mode groups">
			{groups.map((group) => (
				<div key={group.name} className="flex flex-col">
					<div className="flex items-baseline gap-2 px-1.5 pb-0.5">
						<span className="text-xs font-medium text-muted-foreground">{groupLabel(group.name)}</span>
						<span className="truncate text-[11px] text-subtle-foreground">
							{group.options.map((option) => optionLabel(option.name)).join(", ")}
						</span>
					</div>
					{group.options.map((option) => {
						const names = orderedTokenNames(option.light, option.dark);

						return names.length ? (
							<div key={option.name} className="flex flex-col">
								<span className="px-1.5 pt-1 text-[11px] text-subtle-foreground">{optionLabel(option.name)}</span>
								{names.map((name) => (
									<div key={name} className={cn(ROW, "py-0.5 font-mono text-[11px] text-muted-foreground")}>
										<span className="truncate px-1.5" title={name}>
											{name}
										</span>
										<span className="truncate px-1.5">{option.light[name] ?? ""}</span>
										<span className="truncate px-1.5">{option.dark[name] ?? ""}</span>
									</div>
								))}
							</div>
						) : null;
					})}
				</div>
			))}
			{contested.length ? (
				<p className="px-1.5 text-[11px]/4 text-pretty text-warning">
					More than one group sets <span className="font-mono">{contested.join(", ")}</span>. The group written later in
					DESIGN.md wins.
				</p>
			) : null}
		</div>
	);
}

function TokenRow({
	name,
	tokens,
	onEditToken,
}: {
	name: string;
	tokens: DesignTokens;
	onEditToken: (edit: TokenEdit) => void;
}) {
	const [error, setError] = useState<string | null>(null);
	const utilityClass = tokenClass(name);
	const color = tokenKind(name) === "color";

	const renameTo = (raw: string) => {
		const to = normalizeTokenName(raw);

		if (!to) return "Name the token, or remove it";

		const reason = renameError(tokens, name, to);

		if (!reason && to !== name) onEditToken({ kind: "rename", from: name, to });

		return reason;
	};

	const setValue = (mode: TokenMode) => (value: string) => {
		const reason = value ? validateToken(name, value) : null;

		if (!reason) onEditToken({ kind: "set", name, mode, value: value || null });

		return reason;
	};

	return (
		<div role="listitem" className="group flex flex-col py-px">
			<div className={ROW}>
				<div className="flex min-w-0 flex-col">
					<TokenField
						label={`${name} name`}
						value={name}
						invalid={error !== null}
						onCommit={renameTo}
						onError={setError}
					/>
					{utilityClass ? (
						<span className="truncate px-1.5 pb-0.5 font-mono text-[10px] text-subtle-foreground">{utilityClass}</span>
					) : null}
				</div>
				{TOKEN_MODES.map((mode) => (
					<TokenField
						key={mode}
						label={`${name} ${mode} value`}
						value={tokens[mode][name] ?? ""}
						placeholder={fallbackLabel(name, mode)}
						swatch={color}
						invalid={error !== null}
						onCommit={setValue(mode)}
						onError={setError}
					/>
				))}
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={`Remove ${name}`}
					title={`Remove ${name}`}
					className="text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
					onClick={() => onEditToken({ kind: "remove", name })}
				>
					<X />
				</Button>
			</div>
			{error ? <p className="px-1.5 pb-1 text-[11px]/4 text-pretty text-destructive">{error}</p> : null}
		</div>
	);
}
