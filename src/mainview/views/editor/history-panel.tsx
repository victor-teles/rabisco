import { useEffect, useRef, useState } from "react";
import { Bookmark, Bot, GitCommitHorizontal, LoaderCircle, RotateCcw, Sparkles, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { ScreenFrame, ScreenTheme } from "@/components/app/screen-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Snapshot } from "@/lib/history";
import { themeCss } from "@/lib/render/styles";
import { api, isDesktop } from "@/lib/rpc";
import { formatWhen } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
	checkpointVersion,
	defaultCheckpointName,
	isCurrentVersion,
	listVersions,
	previewFrames,
	versionSnapshot,
	type SessionVersion,
	type Version,
} from "@/lib/versions";
import type { AppliedTheme } from "../../../shared/context/theme";
import { cleanCheckpointName, type GitCheckpoint, type GitStatus } from "../../../shared/git";
import { resolveDraft, resolveModes } from "../../../shared/modes";
import { errorMessage } from "./export/share-utils";
import { CHECKPOINT_KEYS } from "./shortcuts";

type Repo = Extract<GitStatus, { state: "repo" }>;

const THUMB = { width: 64, height: 88 };

const PREVIEW_LIMIT = 12;

const NO_TOKENS: AppliedTheme = { light: {}, dark: {} };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const LOCAL_NOTE = isDesktop
	? "Checkpoints are kept on this computer with the undo history. Set up git in Export to share them."
	: "Checkpoints last until you close the project. Set up git in Export to keep them.";

function iconOf(version: Version): LucideIcon {
	if (version.kind === "ai") return Sparkles;

	if (version.kind === "agent") return Bot;

	return version.source === "git" ? GitCommitHorizontal : Bookmark;
}

function metaOf(version: Version) {
	const parts = [
		formatWhen(version.at),
		version.source === "git" ? version.short : isDesktop ? "On this computer" : "This session",
	];

	if (version.source === "session" && version.changed.length) parts.push(plural(version.changed.length, "file"));

	if (version.source === "session" && version.agent) parts.unshift(version.agent);

	return parts.join(" · ");
}

export function HistoryPanel({
	projectPath,
	present,
	versions,
	focusName,
	onNameFocused,
	onFlush,
	onCheckpoint,
	onRestore,
}: {
	projectPath: string;
	present: Snapshot;
	versions: SessionVersion[];
	focusName: number;
	onNameFocused: () => void;
	onFlush: () => Promise<void>;
	onCheckpoint: (version: SessionVersion) => void;
	onRestore: (snapshot: Snapshot, label: string) => void;
}) {
	const [repo, setRepo] = useState<Repo | null>(null);
	const [loading, setLoading] = useState(true);
	const [checkpoints, setCheckpoints] = useState<GitCheckpoint[]>([]);
	const [read, setRead] = useState<ReadonlyMap<string, Snapshot>>(() => new Map());
	const [expanded, setExpanded] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [saving, setSaving] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			try {
				const status = await api.gitStatus({ path: projectPath });
				const found = status.state === "repo" ? status : null;
				const listed = found ? await api.gitCheckpoints({ path: projectPath }) : [];

				if (cancelled) return;
				setRepo(found);
				setCheckpoints(listed);
			} catch (error) {
				if (!cancelled) toast.error("Couldn't read the checkpoints", { description: errorMessage(error) });
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [projectPath]);

	useEffect(() => {
		if (!focusName) return;
		inputRef.current?.focus();
		onNameFocused();
	}, [focusName, onNameFocused]);

	const listed = listVersions(versions, checkpoints);

	async function snapshotOf(version: Version): Promise<Snapshot> {
		if (version.source === "session") return version.snapshot;
		const cached = read.get(version.hash);

		if (cached) return cached;
		const loaded = await api.gitReadCheckpoint({ path: projectPath, hash: version.hash });
		const snapshot = versionSnapshot(loaded.canvas, loaded.files);

		setRead((current) => new Map(current).set(version.hash, snapshot));

		return snapshot;
	}

	function toggle(version: Version) {
		const next = expanded === version.id ? null : version.id;

		setExpanded(next);

		if (next && version.source === "git" && !read.has(version.hash)) {
			snapshotOf(version).catch((error) =>
				toast.error("Couldn't read the checkpoint", { description: errorMessage(error) }),
			);
		}
	}

	async function save() {
		const label = cleanCheckpointName(name) || defaultCheckpointName(new Date());

		if (!repo) {
			onCheckpoint(checkpointVersion(label, present, new Date()));
			setName("");
			toast.success(`Saved “${label}”`, {
				description: LOCAL_NOTE,
			});

			return;
		}

		setSaving(true);

		try {
			await onFlush();
			const saved = await api.gitCheckpoint({ path: projectPath, name: label });

			setCheckpoints((current) => [saved, ...current]);
			setName("");
			toast.success(`Saved “${label}”`, {
				description: `Committed as ${saved.short}${repo.branch ? ` on ${repo.branch}` : ""}.`,
			});
		} catch (error) {
			toast.error("Couldn't save the checkpoint", { description: errorMessage(error) });
		} finally {
			setSaving(false);
		}
	}

	async function restore(version: Version) {
		try {
			onRestore(await snapshotOf(version), version.label);
		} catch (error) {
			toast.error("Couldn't restore the version", { description: errorMessage(error) });
		}
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 flex-col gap-1.5 border-b p-2">
				<form
					className="flex items-center gap-1.5"
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
				>
					<Input
						ref={inputRef}
						value={name}
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => event.key === "Escape" && event.currentTarget.blur()}
						placeholder="Name this version"
						aria-label="Checkpoint name"
						className="h-8 text-[13px] md:text-[13px]"
						disabled={saving}
					/>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button type="submit" size="sm" variant="outline" disabled={saving || loading}>
								{saving ? <LoaderCircle className="animate-spin" /> : <Bookmark />}
								Save
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							Save checkpoint <Kbd>{CHECKPOINT_KEYS}</Kbd>
						</TooltipContent>
					</Tooltip>
				</form>
				<p className="px-0.5 text-[11.5px] text-subtle-foreground">
					{loading
						? "Checking git…"
						: repo
							? `Checkpoints are commits${repo.branch ? ` on ${repo.branch}` : ""}.`
							: LOCAL_NOTE}
				</p>
			</div>
			<div role="list" aria-label="Versions" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
				{listed.length === 0 ? (
					<p className="px-2 py-1 text-[13px] text-subtle-foreground">
						{loading
							? "Loading…"
							: "No versions yet. Save a checkpoint, and AI and coding agent changes show here as they land."}
					</p>
				) : (
					listed.map((version) => {
						const Icon = iconOf(version);
						const open = expanded === version.id;
						const snapshot = version.source === "session" ? version.snapshot : read.get(version.hash);
						const current = open && snapshot ? isCurrentVersion(present, snapshot) : false;

						return (
							<div key={version.id} role="listitem" className={cn("rounded-md", open && "bg-accent/50")}>
								<button
									type="button"
									onClick={() => toggle(version)}
									aria-expanded={open}
									title={version.label}
									className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
								>
									<Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[13px]">{version.label}</span>
										<span className="block truncate text-[11px] text-subtle-foreground tabular-nums">
											{metaOf(version)}
										</span>
									</span>
								</button>
								{open ? (
									<div className="flex flex-col gap-2 px-2 pt-1 pb-2">
										{snapshot ? (
											<VersionPreview snapshot={snapshot} />
										) : (
											<LoaderCircle className="size-4 animate-spin text-muted-foreground" />
										)}
										<Button
											size="xs"
											variant="outline"
											className="self-start"
											disabled={!snapshot || current}
											onClick={() => void restore(version)}
										>
											<RotateCcw />
											{current ? "Current version" : "Restore"}
										</Button>
									</div>
								) : null}
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}

function VersionPreview({ snapshot }: { snapshot: Snapshot }) {
	const frames = previewFrames(snapshot);

	if (!frames.length) return <p className="text-[12px] text-subtle-foreground">No screens in this version.</p>;

	return (
		<ScreenTheme value={themeCss(snapshot.theme ?? NO_TOKENS)}>
			<div className="flex flex-wrap gap-1.5">
				{frames.slice(0, PREVIEW_LIMIT).map((frame) => {
					const scale = Math.min(THUMB.width / frame.width, THUMB.height / frame.height);

					return (
						<span
							key={frame.file}
							title={frame.name}
							className="grid place-items-center"
							style={{ width: THUMB.width, height: THUMB.height }}
						>
							<span
								className="overflow-hidden rounded-[3px] bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.08)]"
								style={{ width: frame.width * scale, height: frame.height * scale }}
							>
								<span className="block origin-top-left" style={{ transform: `scale(${scale})` }}>
									<ScreenFrame
										entry={frame.file}
										files={snapshot.files}
										width={frame.width}
										height={frame.height}
										mode={resolveModes(frame, snapshot.sections ?? [], snapshot.theme ?? NO_TOKENS)}
										draft={resolveDraft(frame, snapshot.sections ?? [])}
										live={false}
									/>
								</span>
							</span>
						</span>
					);
				})}
			</div>
			{frames.length > PREVIEW_LIMIT ? (
				<p className="text-[11px] text-subtle-foreground">{plural(frames.length - PREVIEW_LIMIT, "more screen")}</p>
			) : null}
		</ScreenTheme>
	);
}
