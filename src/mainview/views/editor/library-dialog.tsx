import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, FolderOpen, FolderPlus, LibraryBig, MoreHorizontal, Plus, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	EmptyState,
	EmptyStateAction,
	EmptyStateActions,
	EmptyStateContent,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateMedia,
	EmptyStateTitle,
} from "@/components/ui/uai/empty-state";
import { api, isDesktop } from "@/lib/rpc";
import { seedDesignTokens } from "../../../shared/context/token-edit";
import { tokenKind, type DesignTokens, type TokenKind } from "../../../shared/context/tokens";
import {
	countStatus,
	itemLabel,
	keepMine,
	LIBRARY_FILE,
	libraryStatus,
	makeLibrary,
	parseLibraryLink,
	publishToLibrary,
	takeFromLibrary,
	unlinkLibrary,
	withDependencies,
	type LibraryChange,
	type LibraryContents,
	type LibrarySummary,
} from "../../../shared/libraries";
import type { ProjectFiles } from "../../../shared/types";

export type LibraryDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	files: ProjectFiles;
	/** The theme the screens show; it stands in for DESIGN.md's tokens until DESIGN.md has some */
	applied: DesignTokens;
	/** One undo step over the components, DESIGN.md and library.json */
	onChange: (recipe: (files: ProjectFiles) => ProjectFiles) => void;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const KIND_LABEL: Record<TokenKind, string> = {
	color: "Color",
	text: "Text style",
	font: "Font",
	"font-weight": "Font weight",
	radius: "Radius",
	spacing: "Spacing",
	shadow: "Shadow",
};

function kindLabel(change: LibraryChange) {
	if (change.item.kind === "file") return "Component";
	const kind = tokenKind(change.item.name);

	return kind ? KIND_LABEL[kind] : "Token";
}

/** Why a change is listed, beyond its section */
function changeNote(change: LibraryChange, side: "library" | "project") {
	if (change.project === undefined) return side === "project" ? "Deleted here" : "New";

	if (change.library === undefined) return side === "library" ? "Removed there, kept here" : null;

	if (change.item.kind === "file") return null;

	return side === "library" ? `${change.project} → ${change.library}` : `${change.library} → ${change.project}`;
}

/** Shared components and tokens across projects (decision 0045): use a library, take its updates, publish to it */
export function LibraryDialog({ open, onOpenChange, files, applied, onChange }: LibraryDialogProps) {
	const link = useMemo(() => parseLibraryLink(files[LIBRARY_FILE]), [files]);
	const [libraries, setLibraries] = useState<LibrarySummary[] | null>(null);
	const [contents, setContents] = useState<LibraryContents | null>(null);
	const [busy, setBusy] = useState(false);
	const [naming, setNaming] = useState(false);

	const seeded = useCallback(
		(current: ProjectFiles): ProjectFiles => ({
			...current,
			"DESIGN.md": seedDesignTokens(current["DESIGN.md"] ?? "", applied),
		}),
		[applied],
	);

	const linkId = link?.id;

	const load = useCallback(async () => {
		const list = await api.listLibraries({});
		const linked = linkId && list.some((entry) => entry.id === linkId) ? await api.readLibrary({ id: linkId }) : null;

		return { list, linked };
	}, [linkId]);

	const refresh = useCallback(async () => {
		const { list, linked } = await load();
		setLibraries(list);
		setContents(linked);
	}, [load]);

	useEffect(() => {
		if (!open) return;
		let current = true;

		load()
			.then(({ list, linked }) => {
				if (!current) return;
				setLibraries(list);
				setContents(linked);
			})
			.catch((reason) =>
				toast.error("Couldn't read the libraries", {
					description: reason instanceof Error ? reason.message : String(reason),
				}),
			);

		return () => {
			current = false;
		};
	}, [open, load]);

	const run = async (work: () => Promise<void>, failure: string) => {
		setBusy(true);

		try {
			await work();
		} catch (reason) {
			toast.error(failure, { description: reason instanceof Error ? reason.message : String(reason) });
		} finally {
			setBusy(false);
		}
	};

	const use = (library: LibrarySummary) =>
		run(async () => {
			const read = await api.readLibrary({ id: library.id });

			if (!read) throw new Error("Its folder is gone. Add it again.");
			const conflicts = libraryStatus(seeded(files), null, read).conflicts.length;
			onChange((current) => takeFromLibrary(seeded(current), read));
			setContents(read);
			toast(`Using ${library.name}`, {
				description: `${plural(library.components, "component")} and ${plural(library.tokens, "token")}. ${
					conflicts ? `${plural(conflicts, "conflict")} kept this project's version. ` : ""
				}Press ⌘Z to undo.`,
			});
		}, `Couldn't use ${library.name}`);

	const addFolder = () =>
		run(async () => {
			const added = await api.addLibraryFolder({});

			if (added) toast(`Added ${added.name}`);
			await refresh();
		}, "Couldn't add the folder");

	const create = (name: string) =>
		run(async () => {
			const made = makeLibrary(seeded(files), crypto.randomUUID(), name);
			const summary = await api.createLibrary({ name, files: made.library });
			onChange((current) => ({ ...seeded(current), [LIBRARY_FILE]: made.project[LIBRARY_FILE]! }));
			setNaming(false);
			toast(`Made ${summary.name}`, {
				description: `${plural(summary.components, "component")} and ${plural(summary.tokens, "token")}, in ${summary.path}.`,
			});
			await refresh();
		}, "Couldn't make the library");

	const unlink = () => {
		onChange(unlinkLibrary);
		setContents(null);
		toast(`Unlinked ${link?.name}`, { description: "Its components and tokens stay. Press ⌘Z to undo." });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[min(40rem,85vh)] flex-col gap-0 p-0 sm:max-w-xl">
				<div className="flex h-12 shrink-0 items-center gap-2 border-b pr-12 pl-4">
					<DialogTitle className="text-sm font-medium">{link ? link.name : "Shared library"}</DialogTitle>
					<DialogDescription className="truncate text-xs text-muted-foreground">
						{link
							? contents
								? libraries?.find((entry) => entry.id === link.id)?.path
								: "Linked library"
							: "Components and tokens that projects share"}
					</DialogDescription>
					<div className="flex-1" />
					{link ? (
						<DropdownMenu modal={false}>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon-xs" aria-label="Library actions">
									<MoreHorizontal />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{contents ? (
									<DropdownMenuItem className="text-[13px]" onSelect={() => void api.revealLibrary({ id: link.id })}>
										<FolderOpen />
										Show in Finder
									</DropdownMenuItem>
								) : null}
								<DropdownMenuItem className="text-[13px]" onSelect={unlink}>
									<Unlink />
									Unlink
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
				</div>

				<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
					{!isDesktop ? (
						<p className="px-4 py-6 text-center text-xs text-muted-foreground">
							Libraries are folders on your Mac, so they need the desktop app.
						</p>
					) : link ? (
						contents ? (
							<LinkedLibrary
								key={files[LIBRARY_FILE]}
								files={seeded(files)}
								library={contents}
								busy={busy}
								onUpdate={(keys) => {
									onChange((current) => takeFromLibrary(seeded(current), contents, keys));
									toast(`Updated from ${contents.name}`, { description: "Press ⌘Z to undo." });
								}}
								onKeepMine={(keys) => onChange((current) => keepMine(seeded(current), contents, keys))}
								onPublish={(keys) =>
									run(async () => {
										const result = publishToLibrary(seeded(files), contents, keys);
										await api.writeLibrary({ id: contents.id, changes: result.library });
										onChange((current) => ({ ...seeded(current), [LIBRARY_FILE]: result.project[LIBRARY_FILE]! }));
										toast(`Published ${plural(keys.length, "change")} to ${contents.name}`, {
											description: "Other projects get them when they update.",
										});
										await refresh();
									}, `Couldn't publish to ${contents.name}`)
								}
							/>
						) : libraries ? (
							<div className="p-4">
								<EmptyState variant="compact">
									<EmptyStateContent>
										<EmptyStateHeader>
											<EmptyStateTitle>{link.name} isn't on this Mac</EmptyStateTitle>
											<EmptyStateDescription>
												Its components and tokens are in this project, so screens still work. Add the library's folder
												to take updates and publish.
											</EmptyStateDescription>
										</EmptyStateHeader>
										<EmptyStateActions>
											<EmptyStateAction disabled={busy} onClick={() => void addFolder()}>
												<FolderPlus />
												Add a library folder…
											</EmptyStateAction>
										</EmptyStateActions>
									</EmptyStateContent>
								</EmptyState>
							</div>
						) : null
					) : (
						<LibraryList
							libraries={libraries}
							busy={busy}
							naming={naming}
							onUse={(library) => void use(library)}
							onAddFolder={() => void addFolder()}
							onName={setNaming}
							onCreate={(name) => void create(name)}
						/>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function LibraryList({
	libraries,
	busy,
	naming,
	onUse,
	onAddFolder,
	onName,
	onCreate,
}: {
	libraries: LibrarySummary[] | null;
	busy: boolean;
	naming: boolean;
	onUse: (library: LibrarySummary) => void;
	onAddFolder: () => void;
	onName: (naming: boolean) => void;
	onCreate: (name: string) => void;
}) {
	const [name, setName] = useState("");

	if (!libraries) return null;

	const form = naming ? (
		<form
			className="flex items-center gap-2 border-t px-4 py-3"
			onSubmit={(event) => {
				event.preventDefault();

				if (name.trim()) onCreate(name.trim());
			}}
		>
			<Input
				autoFocus
				value={name}
				onChange={(event) => setName(event.target.value)}
				placeholder="Library name, like Acme UI"
				aria-label="Library name"
				className="h-7 flex-1 text-xs md:text-xs"
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						onName(false);
					}
				}}
			/>
			<Button type="submit" size="xs" disabled={busy || !name.trim()}>
				Make library
			</Button>
		</form>
	) : null;

	if (!libraries.length) {
		return (
			<>
				<div className="p-4">
					<EmptyState variant="compact">
						<EmptyStateMedia>
							<LibraryBig />
						</EmptyStateMedia>
						<EmptyStateContent>
							<EmptyStateHeader>
								<EmptyStateTitle>No libraries yet</EmptyStateTitle>
								<EmptyStateDescription>
									A library is a folder of components and tokens. Projects copy it in, take its updates and publish
									their changes back, so every project keeps one design system.
								</EmptyStateDescription>
							</EmptyStateHeader>
							<EmptyStateActions>
								<EmptyStateAction disabled={busy} onClick={() => onName(true)}>
									<Plus />
									Make one from this project
								</EmptyStateAction>
								<EmptyStateAction emphasis="secondary" disabled={busy} onClick={onAddFolder}>
									<FolderPlus />
									Add a library folder…
								</EmptyStateAction>
							</EmptyStateActions>
						</EmptyStateContent>
					</EmptyState>
				</div>
				{form}
			</>
		);
	}

	return (
		<>
			<ul className="flex flex-col py-1" aria-label="Libraries">
				{libraries.map((library) => (
					<li key={library.id} className="flex items-center gap-3 px-4 py-2">
						<LibraryBig className="size-4 shrink-0 text-muted-foreground" />
						<div className="flex min-w-0 flex-1 flex-col">
							<span className="truncate text-[13px] font-medium">{library.name}</span>
							<span className="truncate text-xs text-subtle-foreground" title={library.path}>
								{plural(library.components, "component")} · {plural(library.tokens, "token")}
							</span>
						</div>
						<Button variant="outline" size="xs" disabled={busy} onClick={() => onUse(library)}>
							Use
						</Button>
					</li>
				))}
			</ul>
			{form ?? (
				<div className="flex items-center gap-2 border-t px-4 py-2">
					<Button variant="ghost" size="xs" disabled={busy} onClick={onAddFolder}>
						<FolderPlus />
						Add a library folder…
					</Button>
					<div className="flex-1" />
					<Button variant="ghost" size="xs" disabled={busy} onClick={() => onName(true)}>
						<Plus />
						Make one from this project
					</Button>
				</div>
			)}
		</>
	);
}

function LinkedLibrary({
	files,
	library,
	busy,
	onUpdate,
	onKeepMine,
	onPublish,
}: {
	files: ProjectFiles;
	library: LibraryContents;
	busy: boolean;
	onUpdate: (keys?: string[]) => void;
	onKeepMine: (keys: string[]) => void;
	onPublish: (keys: string[]) => void;
}) {
	const status = useMemo(() => libraryStatus(files, parseLibraryLink(files[LIBRARY_FILE]), library), [files, library]);

	const outgoing = useMemo(() => [...status.changes, ...status.additions], [status]);

	const [picked, setPicked] = useState<Set<string>>(
		() => new Set(status.changes.flatMap((change) => (change.project === undefined ? [] : [change.key]))),
	);

	const additions = new Set(status.additions.map((change) => change.key));

	/** A component brings the project components it imports */
	const toggle = (key: string, on: boolean) => {
		const next = new Set(picked);

		if (!on) next.delete(key);
		else for (const path of withDependencies(files, [key])) if (path === key || additions.has(path)) next.add(path);
		setPicked(next);
	};

	const publishing = outgoing.filter((change) => picked.has(change.key));

	return (
		<div className="flex flex-col">
			{countStatus(status) ? null : (
				<p className="border-b px-4 py-6 text-center text-xs text-muted-foreground">
					Up to date with {library.name}. Changes here or in the library show up when you open this.
				</p>
			)}

			{status.updates.length ? (
				<Section
					title={`Updates from ${library.name}`}
					count={status.updates.length}
					action={
						<Button size="xs" disabled={busy} onClick={() => onUpdate()}>
							Update
						</Button>
					}
				>
					{status.updates.map((change) => (
						<ChangeRow key={change.key} change={change} note={changeNote(change, "library")} />
					))}
				</Section>
			) : null}

			{status.conflicts.length ? (
				<Section
					title="Changed in both"
					count={status.conflicts.length}
					action={
						status.conflicts.length > 1 ? (
							<Button
								variant="ghost"
								size="xs"
								disabled={busy}
								onClick={() => onUpdate(status.conflicts.map((change) => change.key))}
							>
								Use library's for all
							</Button>
						) : null
					}
				>
					{status.conflicts.map((change) => (
						<ChangeRow key={change.key} change={change} note={changeNote(change, "library")}>
							<Button variant="ghost" size="xs" disabled={busy} onClick={() => onKeepMine([change.key])}>
								Keep mine
							</Button>
							<Button variant="outline" size="xs" disabled={busy} onClick={() => onUpdate([change.key])}>
								Use library's
							</Button>
						</ChangeRow>
					))}
				</Section>
			) : null}

			{status.changes.length ? (
				<Section title="Changed in this project" count={status.changes.length}>
					{status.changes.map((change) => (
						<ChangeRow
							key={change.key}
							change={change}
							note={changeNote(change, "project")}
							checked={picked.has(change.key)}
							onCheckedChange={(on) => toggle(change.key, on)}
						/>
					))}
				</Section>
			) : null}

			{status.additions.length ? (
				<Section title="Only in this project" count={status.additions.length} collapsible>
					{status.additions.map((change) => (
						<ChangeRow
							key={change.key}
							change={change}
							note={changeNote(change, "project")}
							checked={picked.has(change.key)}
							onCheckedChange={(on) => toggle(change.key, on)}
						/>
					))}
				</Section>
			) : null}

			{outgoing.length ? (
				<div className="sticky bottom-0 flex items-center gap-2 border-t bg-background px-4 py-2">
					<span className="text-xs text-muted-foreground">
						{publishing.length
							? `${plural(publishing.length, "change")} checked`
							: "Check what other projects should get"}
					</span>
					<div className="flex-1" />
					<Button
						size="xs"
						variant="outline"
						disabled={busy || !publishing.length}
						onClick={() => onPublish(publishing.map((change) => change.key))}
					>
						Publish to {library.name}
					</Button>
				</div>
			) : null}
		</div>
	);
}

function Section({
	title,
	count,
	action,
	collapsible = false,
	children,
}: {
	title: string;
	count: number;
	action?: ReactNode;
	/** Starts closed */
	collapsible?: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(!collapsible);

	return (
		<section aria-label={title} className="border-b last:border-b-0">
			<div className="flex h-10 items-center gap-2 px-4">
				{collapsible ? (
					<button
						type="button"
						aria-expanded={open}
						onClick={() => setOpen(!open)}
						className="-ml-1 flex items-center gap-1 rounded px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
					>
						<ChevronRight className={open ? "size-3.5 rotate-90" : "size-3.5"} />
						{title}
					</button>
				) : (
					<span className="text-xs font-medium text-muted-foreground">{title}</span>
				)}
				<span className="text-[11px] text-subtle-foreground tabular-nums">{count}</span>
				<div className="flex-1" />
				{action}
			</div>
			{open ? <ul className="flex flex-col pb-2">{children}</ul> : null}
		</section>
	);
}

function ChangeRow({
	change,
	note,
	checked,
	onCheckedChange,
	children,
}: {
	change: LibraryChange;
	note: string | null;
	checked?: boolean;
	onCheckedChange?: (checked: boolean) => void;
	children?: ReactNode;
}) {
	const label = itemLabel(change.item);

	return (
		<li className="flex min-h-8 items-center gap-2.5 px-4">
			{onCheckedChange ? (
				<Checkbox
					checked={checked}
					onCheckedChange={(state) => onCheckedChange(state === true)}
					aria-label={`Publish ${label}`}
				/>
			) : null}
			<span className="w-20 shrink-0 text-[11px] text-subtle-foreground">{kindLabel(change)}</span>
			<span className="min-w-0 truncate font-mono text-xs">{label}</span>
			{note ? <span className="min-w-0 truncate text-xs text-muted-foreground">{note}</span> : null}
			<div className="flex-1" />
			{children}
		</li>
	);
}
