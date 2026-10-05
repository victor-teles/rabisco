import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, FolderDown, Link2, LoaderCircle, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, DESKTOP_ONLY, isDesktop } from "@/lib/rpc";
import { buildShareSnapshot } from "@/lib/share-snapshot";
import { hashString } from "../../../../shared/jsx/hash";
import { toKebab } from "../../../../shared/project";
import { shareScreens, type ShareStatus } from "../../../../shared/share/snapshot";
import type { Frame, ProjectFiles } from "../../../../shared/types";
import type { ExportContext } from "./export-menu";
import { GitSection } from "./git-section";
import { errorMessage, timeAgo } from "./share-utils";

/** Lets the popover tell when a shared link is out of date */
const publishedFingerprints = new Map<string, string>();

const fingerprintOf = (frames: Frame[], files: ProjectFiles) =>
	hashString(JSON.stringify([shareScreens(frames, files), files]));

type ShareTab = "link" | "git";

const isShareTab = (value: string): value is ShareTab => value === "link" || value === "git";

/** Decision 0008 */
export function ShareButton(props: ExportContext) {
	const { projectPath } = props;
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<ShareTab>("link");
	// Kept with the project it belongs to, so another project starts without a link
	const [shared, setShared] = useState<{ path: string; status: ShareStatus | null } | null>(null);
	const status = shared?.path === projectPath ? shared.status : null;

	const setStatus = useCallback(
		(next: ShareStatus | null) => setShared({ path: projectPath, status: next }),
		[projectPath],
	);

	// The main process keeps sharing while the project is open; pick the link back up
	useEffect(() => {
		let cancelled = false;
		api
			.shareStatus({ path: projectPath })
			.then((next) => !cancelled && setStatus(next))
			.catch(() => {});

		return () => {
			cancelled = true;
		};
	}, [setStatus, projectPath]);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" aria-label={status ? "Share (link is on)" : "Share"}>
					<Share2 />
					Share
					{status ? <span aria-hidden="true" className="size-1.5 rounded-full bg-success" /> : null}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-96 p-0">
				<Tabs
					value={tab}
					onValueChange={(value) => {
						if (isShareTab(value)) setTab(value);
					}}
					className="gap-0"
				>
					<div className="flex h-10 items-center border-b px-2">
						<TabsList variant="line" className="h-8!">
							<TabsTrigger value="link" className="px-2 text-[13px]">
								Link
							</TabsTrigger>
							<TabsTrigger value="git" className="px-2 text-[13px]">
								Git
							</TabsTrigger>
						</TabsList>
					</div>
					<TabsContent value="link" className="p-4">
						<LinkSection context={props} status={status} onStatus={setStatus} />
					</TabsContent>
					<TabsContent value="git" className="p-4">
						<GitSection
							projectPath={projectPath}
							projectName={props.projectName}
							onBeforeSync={props.flushCanvas}
							onPulled={props.reloadFromDisk}
						/>
					</TabsContent>
				</Tabs>
			</PopoverContent>
		</Popover>
	);
}

/** Falls back to a selected field and `execCommand` where the Clipboard API is blocked */
async function copyText(text: string, field: HTMLInputElement | null) {
	try {
		await navigator.clipboard.writeText(text);

		return true;
	} catch {
		if (!field) return false;
		field.select();

		return document.execCommand("copy");
	}
}

function LinkSection({
	context,
	status,
	onStatus,
}: {
	context: ExportContext;
	status: ShareStatus | null;
	onStatus: (status: ShareStatus | null) => void;
}) {
	const { projectPath, projectName, frames, files, selected } = context;
	const [busy, setBusy] = useState<"publish" | "stop" | "export" | null>(null);
	const [copied, setCopied] = useState(false);
	const fieldRef = useRef<HTMLInputElement>(null);
	const fingerprint = useMemo(() => fingerprintOf(frames, files), [frames, files]);
	const screenCount = useMemo(() => shareScreens(frames, files).length, [frames, files]);
	const stale = status !== null && publishedFingerprints.get(projectPath) !== fingerprint;

	const snapshot = useCallback(
		() => buildShareSnapshot({ name: projectName, frames, files, start: selected[0]?.file }),
		[projectName, frames, files, selected],
	);

	const publish = async () => {
		setBusy("publish");

		try {
			const next = await api.sharePublish({ path: projectPath, snapshot: await snapshot() });
			publishedFingerprints.set(projectPath, fingerprint);

			if (status)
				toast.success("Link updated", { description: "People with the link see the latest screens when they reload." });
			else {
				const done = await copyText(next.url, null);
				toast.success(done ? "Link ready and copied" : "Link ready", { description: next.url });
			}

			onStatus(next);
		} catch (error) {
			toast.error("Couldn't share the project", { description: errorMessage(error) });
		} finally {
			setBusy(null);
		}
	};

	const stop = async () => {
		setBusy("stop");

		try {
			await api.shareStop({ path: projectPath });
			publishedFingerprints.delete(projectPath);
			onStatus(null);
			toast("Sharing stopped", { description: "The link doesn't work anymore." });
		} catch (error) {
			toast.error("Couldn't stop sharing", { description: errorMessage(error) });
		} finally {
			setBusy(null);
		}
	};

	const exportSite = async () => {
		setBusy("export");

		try {
			const dir = await api.pickExportFolder({});

			if (!dir) return;

			const written = await api.exportViewer({
				dir,
				name: `${toKebab(projectName)}-site`,
				snapshot: await snapshot(),
				reveal: true,
			});

			toast.success("Website exported", {
				description: `Open index.html, or upload the folder to any static host. ${written.dir}`,
			});
		} catch (error) {
			toast.error("Couldn't export the website", { description: errorMessage(error) });
		} finally {
			setBusy(null);
		}
	};

	const copy = async () => {
		if (!status) return;

		if (await copyText(status.url, fieldRef.current)) {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} else toast.error("Couldn't copy the link");
	};

	const noScreens = screenCount === 0;

	return (
		<div className="flex flex-col gap-3">
			{status ? (
				<>
					<div className="flex items-center gap-1">
						<Input
							ref={fieldRef}
							readOnly
							value={status.url}
							aria-label="Share link"
							className="h-8 font-mono text-xs"
							onFocus={(event) => event.currentTarget.select()}
						/>
						<Button variant="ghost" size="icon-sm" aria-label="Copy link" title="Copy link" onClick={copy}>
							{copied ? <Check /> : <Copy />}
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Open in browser"
							title="Open in browser"
							onClick={() =>
								api
									.openExternal({ url: status.localUrl })
									.catch((error) => toast.error("Couldn't open the link", { description: errorMessage(error) }))
							}
						>
							<ExternalLink />
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						{stale
							? "You changed the design since the last update. "
							: `${status.screens} ${status.screens === 1 ? "screen" : "screens"}, updated ${timeAgo(status.updatedAt)}. `}
						Anyone on your network with the link can click through the screens. It works while this project is open.
					</p>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							variant={stale ? "default" : "outline"}
							onClick={publish}
							disabled={busy !== null || noScreens}
						>
							{busy === "publish" ? <LoaderCircle className="motion-safe:animate-spin" /> : null}
							Update link
						</Button>
						<Button size="sm" variant="ghost" onClick={stop} disabled={busy !== null}>
							Stop sharing
						</Button>
					</div>
				</>
			) : (
				<>
					<p className="text-[13px] text-muted-foreground">
						A read-only link to click through your screens, for anyone on the same network. Nothing leaves this
						computer, and the link stops when you stop sharing or close the project.
					</p>
					<Button
						size="sm"
						className="self-start"
						onClick={publish}
						disabled={!isDesktop || busy !== null || noScreens}
					>
						{busy === "publish" ? <LoaderCircle className="motion-safe:animate-spin" /> : <Link2 />}
						Share link
					</Button>
				</>
			)}

			<div className="-mx-4 mt-1 border-t px-4 pt-3">
				<Button
					size="sm"
					variant="ghost"
					className="-ml-2"
					onClick={exportSite}
					disabled={!isDesktop || busy !== null || noScreens}
				>
					{busy === "export" ? <LoaderCircle className="motion-safe:animate-spin" /> : <FolderDown />}
					Export as website…
				</Button>
				<p className="mt-1 text-xs text-muted-foreground">
					The same viewer as a folder: open it from disk, or host it on Netlify or GitHub Pages.
				</p>
			</div>

			{!isDesktop ? (
				<p className="text-xs text-muted-foreground">{DESKTOP_ONLY}</p>
			) : noScreens ? (
				<p className="text-xs text-muted-foreground">Add a screen to share it.</p>
			) : null}
		</div>
	);
}
