import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { FolderOpen } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { api } from "@/lib/rpc";
import { isString } from "../../../../shared/guards";
import { isJsonObject, type Json, type JsonObject } from "../../../../shared/json";
import {
	defaultTarget,
	repoPathProblem,
	repoSync,
	repoSyncPaths,
	type RepoInfo,
} from "../../../../shared/export/repo-sync";
import { localDependencies } from "../../../../shared/export/code";
import { screenNameFromPath } from "../../../../shared/project";
import type { Frame, ProjectFiles } from "../../../../shared/types";

export type RepoSyncRequest = { projectPath: string; screen: Frame; files: ProjectFiles };

type ScreenPlace = { target: string; componentsDir: string };

type Remembered = { repo: string; screens: Record<string, ScreenPlace> };

const STORAGE_KEY = "rabisco.repo-sync";

function parseRemembered(value: Json | undefined): Remembered | null {
	if (!isJsonObject(value) || !isString(value.repo)) return null;
	const screens: Record<string, ScreenPlace> = {};
	const stored: JsonObject = isJsonObject(value.screens) ? value.screens : {};

	for (const [file, place] of Object.entries(stored)) {
		if (isJsonObject(place) && isString(place.target) && isString(place.componentsDir)) {
			screens[file] = { target: place.target, componentsDir: place.componentsDir };
		}
	}

	return { repo: value.repo, screens };
}

function readAll(): JsonObject {
	try {
		const parsed: Json = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");

		return isJsonObject(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

const remembered = (projectPath: string) => parseRemembered(readAll()[projectPath]);

function remember(projectPath: string, repo: string, file: string, place: ScreenPlace) {
	const all = readAll();
	const previous = parseRemembered(all[projectPath]);
	const screens = previous?.repo === repo ? previous.screens : {};

	localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({ ...all, [projectPath]: { repo, screens: { ...screens, [file]: place } } }),
	);
}

let pending: RepoSyncRequest | null = null;

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
	listeners.add(listener);

	return () => void listeners.delete(listener);
};

function setPending(next: RepoSyncRequest | null) {
	pending = next;

	for (const listener of listeners) listener();
}

export function askRepoSync(request: RepoSyncRequest) {
	setPending(request);
}

/** Mounted once in the editor; "Sync to repository…" opens it */
export function RepoSyncDialog() {
	const request = useSyncExternalStore(subscribe, () => pending);

	return (
		<Dialog open={request !== null} onOpenChange={(open) => !open && setPending(null)}>
			<DialogContent className="sm:max-w-lg">{request ? <SyncForm request={request} /> : null}</DialogContent>
		</Dialog>
	);
}

const list = (items: string[]) => items.map((item) => `\`${item}\``).join(", ");

function SyncForm({ request }: { request: RepoSyncRequest }) {
	const { projectPath, screen, files } = request;
	const saved = useMemo(() => remembered(projectPath), [projectPath]);
	const place = saved?.screens[screen.file];
	const [repo, setRepo] = useState(saved?.repo ?? null);
	const [target, setTarget] = useState(place?.target ?? "");
	const [componentsDir, setComponentsDir] = useState(place?.componentsDir ?? "");
	const [info, setInfo] = useState<RepoInfo | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [writing, setWriting] = useState(false);
	const hasComponents = localDependencies(files, screen.file).length > 0;
	const name = screen.name || screenNameFromPath(screen.file);
	const problem = repoPathProblem(target, "file") ?? repoPathProblem(componentsDir, "folder");

	useEffect(() => {
		if (!repo) return;
		let current = true;
		const paths = problem ? [] : repoSyncPaths(files, screen.file, target, componentsDir);

		api
			.repoInfo({ dir: repo, paths })
			.then((next) => {
				if (!current) return;
				setInfo(next);
				setError(null);

				if (!target) {
					setComponentsDir(next.componentsDir);
					setTarget(defaultTarget(screen.file, next.componentsDir));
				}
			})
			.catch((reason: Error) => current && setError(reason.message));

		return () => {
			current = false;
		};
	}, [repo, target, componentsDir, problem, files, screen.file]);

	const sync = useMemo(
		() =>
			repo && !problem
				? repoSync({
						files,
						screen: screen.file,
						target,
						componentsDir,
						uiAlias: info?.uiAlias,
						utilsAlias: info?.utilsAlias,
					})
				: null,
		[repo, problem, files, screen.file, target, componentsDir, info],
	);

	const uiModules = info?.uiModules ?? null;
	const packages = info?.packages ?? null;
	const missingUi = uiModules ? (sync?.ui ?? []).filter((module) => !uiModules.includes(module)) : [];
	const missingPackages = packages ? (sync?.packages ?? []).filter((pkg) => !packages.includes(pkg)) : [];

	const chooseRepo = async () => {
		const dir = await api.pickExportFolder({}).catch(() => null);

		if (!dir) return;

		if (dir !== repo) {
			setTarget("");
			setComponentsDir("");
			setInfo(null);
		}

		setRepo(dir);
	};

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();

		if (!repo || !sync || writing) return;
		setWriting(true);

		try {
			await api.writeExport({ dir: repo, files: sync.files });
			remember(projectPath, repo, screen.file, { target, componentsDir });
			setPending(null);

			const needs = [
				missingUi.length ? `shadcn ${list(missingUi)}` : "",
				missingPackages.length ? list(missingPackages) : "",
			];

			const still = needs.filter(Boolean).join(" and ");

			toast.success(`Synced ${name} to ${target}`, {
				description: still ? `The repository still needs ${still}.` : `${sync.files.length} files in ${repo}`,
			});
		} catch (reason) {
			setWriting(false);
			setError(reason instanceof Error ? reason.message : String(reason));
		}
	};

	const existing = new Set(info?.existing ?? []);

	return (
		<form onSubmit={(event) => void submit(event)} className="grid gap-4">
			<DialogHeader>
				<DialogTitle>Sync {name} to a repository</DialogTitle>
				<DialogDescription>
					Writes the screen as a component, with the components it imports. Run it again after you change the screen.
				</DialogDescription>
			</DialogHeader>
			<div className="flex items-center gap-2">
				<p className="min-w-0 flex-1 truncate text-sm" title={repo ?? undefined}>
					{repo ?? <span className="text-muted-foreground">No repository chosen</span>}
				</p>
				<Button type="button" variant="outline" size="sm" onClick={() => void chooseRepo()} autoFocus={!repo}>
					<FolderOpen />
					{repo ? "Change…" : "Choose repository…"}
				</Button>
			</div>
			{repo ? (
				<div className="grid gap-3">
					<label className="grid gap-1 text-xs text-muted-foreground">
						Screen file
						<Input
							autoFocus
							value={target}
							onChange={(event) => setTarget(event.target.value)}
							aria-invalid={repoPathProblem(target, "file") !== null}
						/>
					</label>
					{hasComponents ? (
						<label className="grid gap-1 text-xs text-muted-foreground">
							Components folder
							<Input
								value={componentsDir}
								onChange={(event) => setComponentsDir(event.target.value)}
								aria-invalid={repoPathProblem(componentsDir, "folder") !== null}
							/>
						</label>
					) : null}
					{sync ? (
						<ul className="grid gap-0.5 rounded-md border bg-muted/40 p-2 font-mono text-xs">
							{sync.files.map((file) => (
								<li key={file.path} className="flex justify-between gap-2">
									<span className="truncate">{file.path}</span>
									<span className="shrink-0 text-muted-foreground">{existing.has(file.path) ? "replaces" : "new"}</span>
								</li>
							))}
						</ul>
					) : null}
					{missingUi.length ? (
						<p className="text-xs text-muted-foreground">
							The repository doesn't have shadcn {missingUi.join(", ")}. Add {missingUi.length === 1 ? "it" : "them"}{" "}
							with <code className="font-mono">npx shadcn@latest add {missingUi.join(" ")}</code>
						</p>
					) : null}
					{missingPackages.length ? (
						<p className="text-xs text-muted-foreground">
							The code also imports {missingPackages.join(", ")}, which package.json doesn't list.
						</p>
					) : null}
				</div>
			) : null}
			{error || (repo && problem) ? <p className="text-xs text-destructive">{error ?? problem}</p> : null}
			<DialogFooter>
				<Button type="button" variant="ghost" onClick={() => setPending(null)}>
					Cancel
				</Button>
				<Button type="submit" disabled={!sync || writing}>
					{sync ? `Write ${sync.files.length} ${sync.files.length === 1 ? "file" : "files"}` : "Write"}
				</Button>
			</DialogFooter>
		</form>
	);
}
