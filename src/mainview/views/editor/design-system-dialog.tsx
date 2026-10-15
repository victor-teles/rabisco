import { useMemo, useRef, useState } from "react";
import { Copy, Import, MoreHorizontal, Plus, Search, Trash2, Unlink, Wand2 } from "lucide-react";
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
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	EmptyState,
	EmptyStateAction,
	EmptyStateActions,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "@/components/ui/uai/empty-state";
import { cn } from "@/lib/utils";
import type { DesignSystemChange } from "../../../shared/context/design-system";
import { normalizeTokenName, renameError, type TokenEdit, type TokenMode } from "../../../shared/context/token-edit";
import { rawTokenMatches, tokenUsages, type RawMatch, type TokenUsage } from "../../../shared/context/token-usage";
import {
	designTokensOf,
	isCustomToken,
	orderedTokenNames,
	parseTextStyle,
	TOKEN_KINDS,
	tokenClass,
	tokenKind,
	validateToken,
	type DesignTokens,
	type TokenKind,
} from "../../../shared/context/tokens";
import { isComponentFile, screenNameFromPath } from "../../../shared/project";
import type { ProjectFiles } from "../../../shared/types";
import { BrandImportDialog, type BrandImport } from "./brand-import-dialog";
import { AddTokenForm, TokenField } from "./token-fields";
import { isTyping } from "./shortcuts";

const CATEGORY: Record<TokenKind, { label: string; example: { name: string; light: string } }> = {
	color: { label: "Colors", example: { name: "color-brand", light: "#e11d48" } },
	text: { label: "Text styles", example: { name: "text-heading", light: "2rem/1.2 600 -0.01em" } },
	font: { label: "Fonts", example: { name: "font-display", light: '"Fraunces", serif' } },
	"font-weight": { label: "Font weights", example: { name: "font-weight-heavy", light: "650" } },
	radius: { label: "Radius", example: { name: "radius-card", light: "1rem" } },
	spacing: { label: "Spacing", example: { name: "spacing-gutter", light: "24px" } },
	shadow: { label: "Shadows", example: { name: "shadow-card", light: "0 4px 12px rgb(0 0 0 / 0.1)" } },
};

const ORDER: TokenKind[] = ["color", "text", "font", "font-weight", "radius", "spacing", "shadow"];

type Filter = TokenKind | "all";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** `4 screens and 1 component` */
function placesOf(paths: string[]) {
	const components = paths.filter(isComponentFile).length;
	const screens = paths.length - components;
	const parts = [screens ? plural(screens, "screen") : "", components ? plural(components, "component") : ""];

	return parts.filter(Boolean).join(" and ");
}

const fileLabel = (path: string) =>
	isComponentFile(path) ? path.replace(/^components\//, "") : screenNameFromPath(path);

const hasAnyToken = (tokens: DesignTokens) =>
	Object.keys(tokens.light).length > 0 || Object.keys(tokens.dark).length > 0;

const isBuiltIn = (name: string) => !isCustomToken(name);

/** The classes a built-in token sets */
function builtInClass(name: string) {
	if (name === "radius") return "rounded-sm to rounded-xl";

	if (name === "spacing") return "p-4, gap-2 and every step";

	return tokenKind(name) === "color" ? `bg-${name}` : name;
}

/** What a screen uses when the mode has no value */
function fallbackLabel(name: string, mode: TokenMode) {
	if (tokenKind(name) === "color" && isBuiltIn(name)) return "Theme";

	return mode === "dark" ? "Same" : "None";
}

export type DesignSystemDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	files: ProjectFiles;
	/** The theme the screens show; it stands in for DESIGN.md until the first edit writes it there */
	applied: DesignTokens;
	/** One undo step each */
	onChange: (change: DesignSystemChange) => void;
	onImportTokens: (tokens: DesignTokens) => void;
	onReplaceDesign: (markdown: string) => void;
};

/** Every token by kind, where screens use it, and the raw values that should be tokens. Changes write DESIGN.md and the
 * screens together. */
export function DesignSystemDialog({
	open,
	onOpenChange,
	files,
	applied,
	onChange,
	onImportTokens,
	onReplaceDesign,
}: DesignSystemDialogProps) {
	const design = files["DESIGN.md"];

	const tokens = useMemo(() => {
		const written = designTokensOf(design);

		return hasAnyToken(written) ? written : applied;
	}, [design, applied]);

	const usages = useMemo(
		() => (open ? tokenUsages(files, tokens) : new Map<string, TokenUsage>()),
		[open, files, tokens],
	);

	const matches = useMemo(() => (open ? rawTokenMatches(files, tokens) : []), [open, files, tokens]);
	const [filter, setFilter] = useState<Filter>("all");
	const [query, setQuery] = useState("");
	const filterInput = useRef<HTMLInputElement>(null);
	const [adding, setAdding] = useState(false);
	const [deleting, setDeleting] = useState<string | null>(null);
	const [importing, setImporting] = useState<BrandImport | null>(null);

	const names = orderedTokenNames(tokens.light, tokens.dark);
	const needle = query.trim().toLowerCase();

	const shown = names.filter((name) => {
		const kind = tokenKind(name);
		const values = `${name} ${tokenClass(name) ?? ""} ${tokens.light[name] ?? ""} ${tokens.dark[name] ?? ""}`;

		return kind && (filter === "all" || filter === kind) && (!needle || values.toLowerCase().includes(needle));
	});

	const counts = new Map(TOKEN_KINDS.map((kind) => [kind, names.filter((name) => tokenKind(name) === kind).length]));
	const addKind: TokenKind = filter === "all" ? "color" : filter;

	const edit = (change: TokenEdit) => onChange({ kind: "token", edit: change });

	const rename = (from: string, to: string) => {
		const usage = usages.get(from);
		edit({ kind: "rename", from, to });
		toast(`Renamed ${from} to ${to}`, {
			description: usage
				? `Updated ${plural(usage.count, "use")} in ${placesOf(usage.paths)}. Press ⌘Z to undo.`
				: "Press ⌘Z to undo.",
		});
	};

	const remove = (name: string, detach: boolean) => {
		const usage = usages.get(name);
		setDeleting(null);
		onChange({ kind: "remove", name, detach });
		toast(`Deleted ${name}`, {
			description:
				usage && detach ? `Wrote its value into ${plural(usage.count, "use")}. Press ⌘Z to undo.` : "Press ⌘Z to undo.",
		});
	};

	const detach = (name: string) => {
		const usage = usages.get(name);

		if (!usage) return;
		onChange({ kind: "detach", name });
		toast(`Detached ${plural(usage.count, "use")} of ${name}`, {
			description: `They have the value now, so ${name} no longer changes them. Press ⌘Z to undo.`,
		});
	};

	const replace = (found: RawMatch[]) => {
		onChange({ kind: "replace-raw", matches: found });
		toast(`Replaced ${plural(found.length, "raw value")} with tokens`, {
			description: `In ${placesOf([...new Set(found.map((match) => match.path))])}. Press ⌘Z to undo.`,
		});
	};

	const askDelete = (name: string) => {
		if (usages.get(name)) setDeleting(name);
		else remove(name, false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="flex h-[min(44rem,85vh)] flex-col gap-0 p-0 sm:max-w-4xl"
				// Esc in a field puts its value back; it closes the view only from outside one
				onEscapeKeyDown={(event) => {
					const target = event.target instanceof HTMLElement ? event.target : null;

					if (target?.closest("[role=listitem], form") && isTyping(target)) event.preventDefault();
					else if (target === filterInput.current && query) {
						event.preventDefault();
						setQuery("");
					}
				}}
			>
				<div className="flex h-12 shrink-0 items-center gap-3 border-b pr-12 pl-4">
					<DialogTitle className="text-sm font-medium">Design system</DialogTitle>
					<DialogDescription className="text-xs text-muted-foreground">
						{names.length ? `${plural(names.length, "token")} in DESIGN.md` : "Tokens live in DESIGN.md"}
					</DialogDescription>
					<div className="flex-1" />
					<div className="relative">
						<Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
						<Input
							ref={filterInput}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Filter tokens"
							aria-label="Filter tokens"
							spellCheck={false}
							className="h-7 w-44 pl-7 text-xs md:text-xs"
						/>
					</div>
					<Button variant="ghost" size="xs" onClick={() => setImporting({ kind: "import" })}>
						<Import />
						Import…
					</Button>
					<Button variant="outline" size="xs" aria-pressed={adding} onClick={() => setAdding((on) => !on)}>
						<Plus />
						Add token
					</Button>
				</div>

				{matches.length ? <RawValues matches={matches} tokens={tokens} onReplace={replace} /> : null}

				<div className="flex min-h-0 flex-1">
					<nav aria-label="Token kinds" className="flex w-44 shrink-0 flex-col gap-px border-r p-2">
						<CategoryButton
							label="All tokens"
							count={names.length}
							active={filter === "all"}
							onClick={() => setFilter("all")}
						/>
						<div className="my-1 h-px bg-border" />
						{ORDER.map((kind) => (
							<CategoryButton
								key={kind}
								label={CATEGORY[kind].label}
								count={counts.get(kind) ?? 0}
								active={filter === kind}
								onClick={() => setFilter(kind)}
							/>
						))}
					</nav>

					<div className="flex min-h-0 flex-1 flex-col overflow-y-auto" role="list" aria-label="Design tokens">
						{adding ? (
							<div className="border-b px-3 py-2">
								<AddTokenForm
									key={addKind}
									tokens={tokens}
									example={CATEGORY[addKind].example}
									onAdd={(change) => {
										edit(change);
										setAdding(false);
									}}
									onClose={() => setAdding(false)}
								/>
							</div>
						) : null}

						{!names.length && !adding ? (
							<div className="flex flex-1 items-center justify-center p-6">
								<EmptyState variant="plain">
									<EmptyStateContent>
										<EmptyStateHeader>
											<EmptyStateTitle>No tokens yet</EmptyStateTitle>
											<EmptyStateDescription>
												Add a color, text style, radius or shadow, or import a theme. Screens use each one as a class,
												like <span className="font-mono">bg-brand</span>.
											</EmptyStateDescription>
										</EmptyStateHeader>
										<EmptyStateActions>
											<EmptyStateAction onClick={() => setAdding(true)}>
												<Plus />
												Add token
											</EmptyStateAction>
											<EmptyStateAction emphasis="secondary" onClick={() => setImporting({ kind: "import" })}>
												<Import />
												Import tokens…
											</EmptyStateAction>
										</EmptyStateActions>
									</EmptyStateContent>
								</EmptyState>
							</div>
						) : null}

						{names.length && !shown.length ? (
							<p className="px-4 py-6 text-center text-xs text-muted-foreground">
								{needle ? `No tokens match “${query.trim()}”.` : `No ${CATEGORY[addKind].label.toLowerCase()} yet.`}
							</p>
						) : null}

						{ORDER.map((kind) => {
							const group = shown.filter((name) => tokenKind(name) === kind);

							if (!group.length) return null;

							return (
								<section key={kind} aria-label={CATEGORY[kind].label} className="pb-2">
									<div className="sticky top-0 z-10 grid grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem_1.5rem] items-center gap-2 border-b bg-background/95 px-3 py-1.5 text-[10px] font-medium text-subtle-foreground uppercase backdrop-blur">
										<span className="col-span-2 normal-case text-xs text-muted-foreground">{CATEGORY[kind].label}</span>
										<span className="px-1.5">Light</span>
										<span className="px-1.5">Dark</span>
										<span>Used</span>
									</div>
									{group.map((name) => (
										<DesignTokenRow
											key={name}
											name={name}
											tokens={tokens}
											usage={usages.get(name)}
											onEdit={edit}
											onRename={rename}
											onDetach={() => detach(name)}
											onDelete={() => askDelete(name)}
										/>
									))}
								</section>
							);
						})}
					</div>
				</div>

				<div className="flex h-9 shrink-0 items-center gap-1.5 border-t px-4 text-[11px] text-subtle-foreground">
					Changes write DESIGN.md and the screens that use the token. Each one is a single undo step:
					<Kbd>⌘Z</Kbd>
				</div>

				<DeleteDialog
					name={deleting}
					usage={deleting ? usages.get(deleting) : undefined}
					tokens={tokens}
					onCancel={() => setDeleting(null)}
					onDelete={remove}
				/>
				<BrandImportDialog
					request={importing}
					current={tokens}
					onClose={() => setImporting(null)}
					onApplyTokens={onImportTokens}
					onReplaceDesign={onReplaceDesign}
				/>
			</DialogContent>
		</Dialog>
	);
}

function CategoryButton({
	label,
	count,
	active,
	onClick,
}: {
	label: string;
	count: number;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-current={active ? "true" : undefined}
			onClick={onClick}
			className={cn(
				"flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
				active ? "bg-accent font-medium text-foreground" : "text-muted-foreground",
			)}
		>
			<span className="flex-1 truncate">{label}</span>
			<span className={cn("tabular-nums text-[11px]", count ? "text-subtle-foreground" : "text-subtle-foreground/50")}>
				{count}
			</span>
		</button>
	);
}

/** A small sample of what the token draws */
function TokenPreview({ name, value }: { name: string; value: string | undefined }) {
	const kind = tokenKind(name);
	const frame = "flex size-7 shrink-0 items-center justify-center rounded-md border bg-background";

	if (!value || !kind) return <span aria-hidden className={cn(frame, "border-dashed")} />;

	switch (kind) {
		case "color":
			return (
				<span
					aria-hidden
					className="size-7 shrink-0 rounded-md shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
					style={{ background: value }}
				/>
			);
		case "text": {
			const style = parseTextStyle(value);

			return (
				<span aria-hidden className={cn(frame, "text-[13px] leading-none")} style={{ fontWeight: style?.weight }}>
					Aa
				</span>
			);
		}

		case "font":
			return (
				<span aria-hidden className={cn(frame, "text-[13px] leading-none")} style={{ fontFamily: value }}>
					Aa
				</span>
			);
		case "font-weight":
			return (
				<span aria-hidden className={cn(frame, "text-[13px] leading-none")} style={{ fontWeight: value }}>
					Aa
				</span>
			);
		case "radius":
			return (
				<span aria-hidden className={frame}>
					<span
						className="size-4 border-t-2 border-l-2 border-foreground/50"
						style={{ borderTopLeftRadius: `min(${value}, 1rem)` }}
					/>
				</span>
			);
		case "spacing":
			return (
				<span aria-hidden className={frame}>
					<span className="h-2 max-w-5 rounded-[2px] bg-foreground/30" style={{ width: value }} />
				</span>
			);
		case "shadow":
			return (
				<span aria-hidden className="flex size-7 shrink-0 items-center justify-center">
					<span className="size-5 rounded-[4px] bg-background" style={{ boxShadow: value }} />
				</span>
			);
	}
}

function DesignTokenRow({
	name,
	tokens,
	usage,
	onEdit,
	onRename,
	onDetach,
	onDelete,
}: {
	name: string;
	tokens: DesignTokens;
	usage: TokenUsage | undefined;
	onEdit: (edit: TokenEdit) => void;
	onRename: (from: string, to: string) => void;
	onDetach: () => void;
	onDelete: () => void;
}) {
	const [error, setError] = useState<string | null>(null);
	const utilityClass = tokenClass(name);
	const color = tokenKind(name) === "color";

	const renameTo = (raw: string) => {
		const to = normalizeTokenName(raw);

		if (!to) return "Name the token, or delete it";

		const reason = renameError(tokens, name, to);

		if (!reason && to !== name) onRename(name, to);

		return reason;
	};

	const setValue = (mode: TokenMode) => (value: string) => {
		const reason = value ? validateToken(name, value) : null;

		if (!reason) onEdit({ kind: "set", name, mode, value: value || null });

		return reason;
	};

	const copyClass = async () => {
		if (!utilityClass) return;
		await navigator.clipboard.writeText(utilityClass);
		toast(`Copied ${utilityClass}`);
	};

	return (
		<div role="listitem" className="group flex flex-col border-b border-border/50 px-3 py-1.5 last:border-b-0">
			<div className="grid grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem_1.5rem] items-center gap-2">
				<TokenPreview name={name} value={tokens.light[name] ?? tokens.dark[name]} />
				<div className="flex min-w-0 flex-col">
					{isBuiltIn(name) ? (
						<span className="truncate px-1.5 font-mono text-[11px]" title="Built-in names can't be renamed">
							{name}
						</span>
					) : (
						<TokenField
							label={`${name} name`}
							value={name}
							invalid={error !== null}
							onCommit={renameTo}
							onError={setError}
						/>
					)}
					<span className="truncate px-1.5 font-mono text-[10px] text-subtle-foreground">
						{utilityClass ?? builtInClass(name)}
					</span>
				</div>
				{(["light", "dark"] as const).map((mode) => (
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
				<UsageCell usage={usage} />
				<DropdownMenu modal={false}>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={`${name} actions`}
							className="text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
						>
							<MoreHorizontal />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-52">
						{utilityClass ? (
							<DropdownMenuItem className="text-[13px]" onSelect={() => void copyClass()}>
								<Copy />
								Copy class
							</DropdownMenuItem>
						) : null}
						<DropdownMenuItem className="text-[13px]" disabled={!usage} onSelect={onDetach}>
							<Unlink />
							<span className="flex flex-col">
								{usage ? `Detach ${plural(usage.count, "use")}` : "Detach uses"}
								<span className="text-xs text-subtle-foreground">Write the value into each use</span>
							</span>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem className="text-[13px]" variant="destructive" onSelect={onDelete}>
							<Trash2 />
							{usage ? "Delete…" : "Delete"}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{error ? <p className="pt-0.5 pl-10 text-[11px]/4 text-pretty text-destructive">{error}</p> : null}
		</div>
	);
}

function UsageCell({ usage }: { usage: TokenUsage | undefined }) {
	if (!usage) return <span className="text-[11px] text-subtle-foreground/70">Unused</span>;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					tabIndex={0}
					className="truncate rounded text-[11px] text-muted-foreground tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{plural(usage.count, "use")}
				</span>
			</TooltipTrigger>
			<TooltipContent side="left" className="max-w-64">
				In {placesOf(usage.paths)}: {usage.paths.map(fileLabel).join(", ")}
			</TooltipContent>
		</Tooltip>
	);
}

type RawGroup = { token: string; matches: RawMatch[]; raws: string[] };

function groupMatches(matches: RawMatch[]): RawGroup[] {
	const groups = new Map<string, RawGroup>();

	for (const match of matches) {
		const group = groups.get(match.token) ?? { token: match.token, matches: [], raws: [] };
		group.matches.push(match);

		if (!group.raws.includes(match.raw)) group.raws.push(match.raw);
		groups.set(match.token, group);
	}

	return [...groups.values()];
}

/** "12 raw values in 4 screens match a token", with a way to see them and replace them */
function RawValues({
	matches,
	tokens,
	onReplace,
}: {
	matches: RawMatch[];
	tokens: DesignTokens;
	onReplace: (matches: RawMatch[]) => void;
}) {
	const [open, setOpen] = useState(false);
	const groups = groupMatches(matches);
	const paths = [...new Set(matches.map((match) => match.path))];

	return (
		<div className="shrink-0 border-b bg-muted/40">
			<div className="flex h-10 items-center gap-2 px-4 text-xs">
				<Wand2 className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate">
					<span className="font-medium">{plural(matches.length, "raw value")}</span>
					<span className="text-muted-foreground">
						{" "}
						in {placesOf(paths)} {matches.length === 1 ? "matches a token" : "match tokens"}
					</span>
				</span>
				<Button variant="ghost" size="xs" aria-expanded={open} onClick={() => setOpen((on) => !on)}>
					{open ? "Hide" : "Review"}
				</Button>
				<Button variant="outline" size="xs" onClick={() => onReplace(matches)}>
					Replace all
				</Button>
			</div>
			{open ? (
				<ul className="max-h-48 overflow-y-auto px-2 pb-2" aria-label="Raw values that match a token">
					{groups.map((group) => (
						<li key={group.token} className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-accent/60">
							{tokenKind(group.token) === "color" ? (
								<span
									aria-hidden
									className="size-3.5 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
									style={{ background: tokens.light[group.token] }}
								/>
							) : (
								<span aria-hidden className="size-3.5 shrink-0" />
							)}
							<span className="min-w-0 flex-1 truncate font-mono text-[11px]">
								<span className="text-muted-foreground">
									{group.raws.slice(0, 3).join(", ")}
									{group.raws.length > 3 ? ` +${group.raws.length - 3}` : ""}
								</span>
								<span className="text-subtle-foreground"> → </span>
								{group.matches[0]!.replacement}
							</span>
							<span className="shrink-0 text-[11px] text-subtle-foreground tabular-nums">{group.matches.length}</span>
							<Button variant="ghost" size="xs" onClick={() => onReplace(group.matches)}>
								Replace
							</Button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

function DeleteDialog({
	name,
	usage,
	tokens,
	onCancel,
	onDelete,
}: {
	name: string | null;
	usage: TokenUsage | undefined;
	tokens: DesignTokens;
	onCancel: () => void;
	onDelete: (name: string, detach: boolean) => void;
}) {
	const value = name ? (tokens.light[name] ?? tokens.dark[name]) : undefined;

	return (
		<Dialog open={name !== null && usage !== undefined} onOpenChange={(next) => !next && onCancel()}>
			<DialogContent className="sm:max-w-sm" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle className="text-base">Delete {name}?</DialogTitle>
					<DialogDescription className="text-[13px]">
						{usage ? `It has ${plural(usage.count, "use")} in ${placesOf(usage.paths)}. ` : ""}
						Detach writes <span className="font-mono">{value}</span> into each use, so the screens look the same. Delete
						only leaves the classes without a value.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" size="sm" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="outline" size="sm" onClick={() => name && onDelete(name, false)}>
						Delete only
					</Button>
					<Button size="sm" autoFocus onClick={() => name && onDelete(name, true)}>
						Detach and delete
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
