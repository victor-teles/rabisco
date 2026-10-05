import { useCallback, useEffect, useState } from "react";
import {
	ArrowDown,
	ArrowUp,
	ChevronRight,
	CircleAlert,
	GitBranch,
	GitCommitHorizontal,
	LoaderCircle,
	RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { api, DESKTOP_ONLY } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import type { GitStatus } from "../../../../shared/git";
import { errorMessage, timeAgo } from "./share-utils";

type Busy = "load" | "init" | "remote" | "sync" | null;

type Failure = { error: string; detail?: string };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Git sync (decision 0008): set up a repository, set its remote, and sync:
 * commit the project folder, bring in the remote's commits, push. Pulled screens
 * reach the canvas through the folder watcher; the canvas layout is reloaded.
 */
export function GitSection({
	projectPath,
	projectName,
	onBeforeSync,
	onPulled,
}: {
	projectPath: string;
	projectName: string;
	onBeforeSync: () => Promise<void>;
	/** `rabisco.json` isn't watched: the editor reads it again when a sync brought in commits */
	onPulled: () => Promise<void>;
}) {
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [busy, setBusy] = useState<Busy>("load");
	const [failure, setFailure] = useState<Failure | null>(null);
	const [editingRemote, setEditingRemote] = useState(false);
	const [remoteUrl, setRemoteUrl] = useState("");

	const fetchStatus = useCallback(
		(): Promise<GitStatus> =>
			api
				.gitStatus({ path: projectPath })
				.catch((error) => ({ state: "unavailable", error: errorMessage(error) }) as const),
		[projectPath],
	);

	const load = useCallback(async () => {
		setBusy("load");
		setStatus(await fetchStatus());
		setBusy(null);
	}, [fetchStatus]);

	// `busy` starts as "load"
	useEffect(() => {
		let cancelled = false;
		void fetchStatus().then((next) => {
			if (cancelled) return;
			setStatus(next);
			setBusy(null);
		});

		return () => {
			cancelled = true;
		};
	}, [fetchStatus]);

	const act = async (kind: Exclude<Busy, null>, action: () => Promise<GitStatus>, failureTitle: string) => {
		setBusy(kind);
		setFailure(null);

		try {
			setStatus(await action());

			return true;
		} catch (error) {
			setFailure({ error: errorMessage(error) });
			toast.error(failureTitle, { description: errorMessage(error) });

			return false;
		} finally {
			setBusy(null);
		}
	};

	const init = () =>
		act("init", () => api.gitInit({ path: projectPath, name: projectName }), "Couldn't set up git").then(
			(done) => done && toast.success("Git is set up", { description: "Rabisco made the first commit." }),
		);

	const saveRemote = async () => {
		const done = await act(
			"remote",
			() => api.gitSetRemote({ path: projectPath, url: remoteUrl }),
			"Couldn't set the remote",
		);

		if (done) {
			setEditingRemote(false);
			setRemoteUrl("");
		}
	};

	const sync = async () => {
		setBusy("sync");
		setFailure(null);

		try {
			await onBeforeSync();
			const result = await api.gitSync({ path: projectPath });

			if (result.ok && result.pulled > 0) await onPulled();

			if (result.ok) toast.success(result.remote ? "Synced" : "Committed", { description: result.summary });
			else {
				setFailure(result);
				toast.error("Sync stopped", { description: result.error });
			}
		} catch (error) {
			setFailure({ error: errorMessage(error) });
		}

		await load();
	};

	if (status === null) {
		return (
			<p className="flex items-center gap-2 text-[13px] text-muted-foreground">
				<LoaderCircle className="size-4 motion-safe:animate-spin" />
				Checking git…
			</p>
		);
	}

	if (status.state === "unavailable") {
		const desktopOnly = status.error === DESKTOP_ONLY;

		return (
			<div className="flex flex-col gap-3">
				<p className="flex gap-2 text-[13px] text-muted-foreground">
					<CircleAlert className="mt-0.5 size-4 shrink-0" />
					<span>{status.error}</span>
				</p>
				{desktopOnly ? null : (
					<div className="flex gap-2">
						<Button
							size="sm"
							variant="outline"
							onClick={() => api.openExternal({ url: "https://git-scm.com/downloads" })}
						>
							Get git
						</Button>
						<Button size="sm" variant="ghost" onClick={load} disabled={busy !== null}>
							Check again
						</Button>
					</div>
				)}
			</div>
		);
	}

	if (status.state === "none") {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-[13px] text-muted-foreground">
					Keep every version of this project in git, and back it up to GitHub or any git host. The screens are plain TSX
					files, so developers can review and diff them.
				</p>
				<Button size="sm" className="self-start" onClick={init} disabled={busy !== null}>
					{busy === "init" ? <LoaderCircle className="motion-safe:animate-spin" /> : <GitBranch />}
					Set up git
				</Button>
				{failure ? <FailureNote failure={failure} /> : null}
			</div>
		);
	}

	const { branch, remote, changes, ahead, behind, lastCommit, unfinished, prefix, root } = status;
	const canSync = busy === null && !unfinished && branch !== null && (remote !== null || changes > 0);
	const showRemoteField = !remote || editingRemote;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2 text-[13px]">
				<GitBranch className="size-4 shrink-0 text-muted-foreground" />
				<span className="font-medium">{branch ?? "Detached HEAD"}</span>
				<span className="min-w-0 flex-1 truncate text-muted-foreground" title={remote?.url}>
					{remote ? remote.url : "No remote"}
				</span>
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label="Refresh"
					title="Refresh"
					onClick={load}
					disabled={busy !== null}
				>
					<RefreshCw className={cn(busy === "load" && "motion-safe:animate-spin")} />
				</Button>
			</div>

			<ul className="flex flex-col gap-1 text-xs text-muted-foreground">
				<li>{changes ? `${plural(changes, "changed file")} to commit` : "No changes since the last commit"}</li>
				{remote && (ahead || behind) ? (
					<li className="flex items-center gap-2">
						{ahead ? (
							<span className="inline-flex items-center gap-0.5">
								<ArrowUp className="size-3" />
								{plural(ahead, "commit")} to push
							</span>
						) : null}
						{behind ? (
							<span className="inline-flex items-center gap-0.5">
								<ArrowDown className="size-3" />
								{plural(behind, "commit")} to bring in
							</span>
						) : null}
					</li>
				) : null}
				{lastCommit ? (
					<li className="flex min-w-0 items-center gap-1" title={`${lastCommit.hash} ${lastCommit.subject}`}>
						<GitCommitHorizontal className="size-3 shrink-0" />
						<span className="truncate">{lastCommit.subject}</span>
						<span className="shrink-0">· {timeAgo(lastCommit.date)}</span>
					</li>
				) : null}
				{prefix ? <li title={root}>Inside a bigger repository: sync only commits this project's folder.</li> : null}
			</ul>

			{unfinished ? (
				<p className="flex gap-2 text-xs text-warning">
					<CircleAlert className="size-3.5 shrink-0" />A {unfinished} is in progress in this repository. Finish or abort
					it in a terminal first.
				</p>
			) : null}

			{showRemoteField ? (
				<form
					className="flex flex-col gap-1.5"
					onSubmit={(event) => {
						event.preventDefault();
						void saveRemote();
					}}
				>
					<label htmlFor="git-remote" className="text-xs text-muted-foreground">
						{remote ? "New remote URL" : "Back it up: paste the URL of an empty repository on GitHub or any git host"}
					</label>
					<div className="flex gap-1.5">
						<Input
							id="git-remote"
							value={remoteUrl}
							onChange={(event) => setRemoteUrl(event.target.value)}
							placeholder="https://github.com/you/app.git"
							spellCheck={false}
							autoComplete="off"
							className="h-8 font-mono text-xs"
						/>
						<Button type="submit" size="sm" variant="outline" disabled={busy !== null || !remoteUrl.trim()}>
							{busy === "remote" ? <LoaderCircle className="motion-safe:animate-spin" /> : null}
							{remote ? "Save" : "Add"}
						</Button>
						{remote ? (
							<Button type="button" size="sm" variant="ghost" onClick={() => setEditingRemote(false)}>
								Cancel
							</Button>
						) : null}
					</div>
				</form>
			) : null}

			{failure ? <FailureNote failure={failure} /> : null}

			<div className="flex items-center gap-2">
				<Button size="sm" onClick={sync} disabled={!canSync}>
					{busy === "sync" ? <LoaderCircle className="motion-safe:animate-spin" /> : <RefreshCw />}
					{remote ? "Sync" : "Commit changes"}
				</Button>
				{remote && !editingRemote ? (
					<Button size="sm" variant="ghost" onClick={() => setEditingRemote(true)} disabled={busy !== null}>
						Change remote
					</Button>
				) : null}
			</div>
			<p className="text-xs text-muted-foreground">
				{remote
					? "Sync commits this project, brings in new commits from the remote, then pushes. It never overwrites the remote."
					: "Commits this project's files with a message that lists what changed."}
			</p>
		</div>
	);
}

/** A git failure: the sentence, with git's own output behind a disclosure. */
function FailureNote({ failure }: { failure: Failure }) {
	return (
		<div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
			<p className="flex gap-2 text-destructive">
				<CircleAlert className="mt-px size-3.5 shrink-0" />
				<span>{failure.error}</span>
			</p>
			{failure.detail ? (
				<Collapsible>
					<CollapsibleTrigger className="group mt-1.5 flex items-center gap-1 text-muted-foreground hover:text-foreground">
						<ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
						Git output
					</CollapsibleTrigger>
					<CollapsibleContent>
						<pre className="mt-1.5 max-h-40 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap select-text">
							{failure.detail}
						</pre>
					</CollapsibleContent>
				</Collapsible>
			) : null}
		</div>
	);
}
