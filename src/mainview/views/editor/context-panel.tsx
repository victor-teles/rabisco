import { useMemo, useRef, useState } from "react";
import { Check, FileText, FolderInput, MessageSquareText, MoreHorizontal, Plus, Wand2, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
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
import { contextBody } from "../../../shared/context/body";
import { CONTEXT_TEMPLATES } from "../../../shared/context/templates";
import {
	normalizeTokenName,
	parseTokenForm,
	renameError,
	type TokenEdit,
	type TokenForm,
	type TokenFormErrors,
	type TokenMode,
} from "../../../shared/context/token-edit";
import {
	isCustomToken,
	orderedTokenNames,
	parseDesignTokens,
	tokenClass,
	tokenKind,
	validateToken,
	type DesignTokens,
} from "../../../shared/context/tokens";
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
	/** One undo step that writes DESIGN.md and applies its tokens to the screens */
	onEditToken: (edit: TokenEdit) => void;
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
						<TokenEditor
							markdown={source}
							onEditToken={onEditToken}
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

const ROW = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_1.5rem] items-start gap-1";

const FIELD =
	"h-6 rounded-[5px] border-transparent bg-transparent px-1.5 font-mono text-[11px] shadow-none hover:border-input focus-visible:border-ring focus-visible:ring-0 md:text-[11px] dark:bg-transparent";

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
	onJumpToLine,
}: {
	markdown: string;
	onEditToken: (edit: TokenEdit) => void;
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

			{names.length || adding ? (
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
			</div>

			{!names.length && !adding && hasContent ? (
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

/** Enter or blur commits, Esc puts the value back. `onCommit` writes the value, or returns why it can't. */
function TokenField({
	label,
	value,
	placeholder,
	swatch = false,
	invalid,
	onCommit,
	onError,
}: {
	label: string;
	value: string;
	placeholder?: string;
	swatch?: boolean;
	invalid: boolean;
	onCommit: (next: string) => string | null;
	onError: (reason: string | null) => void;
}) {
	const [draft, setDraft] = useState(value);
	const [shown, setShown] = useState(value);
	const cancelled = useRef(false);

	// DESIGN.md changed under the field (undo, the text editor): show the new value
	if (shown !== value) {
		setShown(value);
		setDraft(value);
	}

	const commit = () => {
		const next = draft.trim();

		if (next === value) {
			setDraft(value);
			onError(null);

			return;
		}

		const reason = onCommit(next);

		if (!reason) setDraft(value);
		onError(reason);
	};

	return (
		<div className="relative min-w-0">
			{swatch && value ? (
				<span
					aria-hidden
					className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 rounded-[3px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
					style={{ background: value }}
				/>
			) : null}
			<Input
				value={draft}
				placeholder={placeholder}
				aria-label={label}
				aria-invalid={invalid && draft !== value ? true : undefined}
				title={draft || placeholder}
				spellCheck={false}
				autoComplete="off"
				className={cn(FIELD, swatch && value && "pl-6", "placeholder:text-subtle-foreground")}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={() => {
					if (cancelled.current) cancelled.current = false;
					else commit();
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					} else if (event.key === "Escape") {
						event.preventDefault();
						cancelled.current = true;
						setDraft(value);
						onError(null);
						event.currentTarget.blur();
					}
				}}
			/>
		</div>
	);
}

const EMPTY_FORM: TokenForm = { name: "", light: "", dark: "" };

/** Enter adds, Esc closes */
function AddTokenForm({
	tokens,
	onAdd,
	onClose,
}: {
	tokens: DesignTokens;
	onAdd: (edit: TokenEdit) => void;
	onClose: () => void;
}) {
	const [form, setForm] = useState<TokenForm>(EMPTY_FORM);
	const [errors, setErrors] = useState<TokenFormErrors>({});
	const name = normalizeTokenName(form.name);
	const color = tokenKind(name) === "color";
	const messages = [errors.name, errors.light, errors.dark].filter((message) => message !== undefined);

	const submit = () => {
		const parsed = parseTokenForm(form, tokens);

		if (parsed.edit) onAdd(parsed.edit);
		else setErrors(parsed.errors);
	};

	const field = (key: keyof TokenForm, placeholder: string) => {
		const value = form[key].trim();
		const showSwatch = key !== "name" && color && value !== "" && validateToken(name, value) === null;

		return (
			<div className="relative min-w-0">
				{showSwatch ? (
					<span
						aria-hidden
						className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 rounded-[3px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
						style={{ background: value }}
					/>
				) : null}
				<Input
					value={form[key]}
					placeholder={placeholder}
					aria-label={`New token ${key === "name" ? "name" : `${key} value`}`}
					aria-invalid={errors[key] ? true : undefined}
					autoFocus={key === "name"}
					spellCheck={false}
					autoComplete="off"
					className={cn(FIELD, "border-input placeholder:text-subtle-foreground", showSwatch && "pl-6")}
					onChange={(event) => {
						setForm({ ...form, [key]: event.target.value });
						setErrors({ ...errors, [key]: undefined });
					}}
				/>
			</div>
		);
	};

	return (
		<form
			role="listitem"
			aria-label="Add token"
			className="flex flex-col py-1"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					onClose();
				}
			}}
		>
			<div className={ROW}>
				{field("name", "color-brand")}
				{field("light", "Light")}
				{field("dark", "Dark")}
				<Button type="submit" variant="ghost" size="icon-xs" aria-label="Add token" title="Add token (Enter)">
					<Check />
				</Button>
			</div>
			{name && !errors.name && tokenClass(name) ? (
				<span className="px-1.5 pt-0.5 font-mono text-[10px] text-subtle-foreground">{tokenClass(name)}</span>
			) : null}
			{messages.map((message) => (
				<p key={message} className="px-1.5 pt-0.5 text-[11px]/4 text-pretty text-destructive">
					{message}
				</p>
			))}
		</form>
	);
}
