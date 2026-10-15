import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, GitBranch, Globe, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, DESKTOP_ONLY, isDesktop } from "@/lib/rpc";
import { buildShareSnapshot } from "@/lib/share-snapshot";
import {
	DEFAULT_PAGES_BRANCH,
	generatePassphrase,
	isPublishHost,
	isTokenHost,
	MIN_PASSWORD_LENGTH,
	PUBLISH_HOST_INFO,
	PUBLISH_HOSTS,
	TOKEN_HOST_INFO,
	type PagesStatus,
	type PublishHost,
	type PublishHostStatus,
	type PublishTarget,
} from "../../../../shared/share/publish";
import { draftedSections } from "../../../../shared/modes";
import { shareScreens } from "../../../../shared/share/snapshot";
import type { ExportContext } from "./export-menu";
import {
	copyLater,
	copyText,
	daysFrom,
	errorMessage,
	expiryDay,
	expiryFromDate,
	localDate,
	shortDate,
	timeAgo,
} from "./share-utils";

type Busy = "load" | "connect" | "disconnect" | "publish" | "remove" | null;

const DEFAULT_EXPIRY_DAYS = 7;

/** The tab unmounts while the Git tab is open; coming back from git setup keeps GitHub Pages picked */
let pickedHost: PublishHost = "netlify";

const PAGES_SETUP = {
	repo: "GitHub Pages publishes through git sync. Set up git for this project and add a GitHub repository as its remote.",
	remote: "GitHub Pages publishes through git sync. Add a GitHub repository as the project's remote.",
	github: "GitHub Pages needs a remote on GitHub. Change the project's remote to a GitHub repository.",
} as const;

/** Decision 0038: the exported website on a host the user owns. GitHub Pages goes through git sync (0043). */
export function PublishSection({ context, onOpenGit }: { context: ExportContext; onOpenGit: () => void }) {
	const { projectPath, projectName, frames, sections, files, theme, selected } = context;
	const [hosts, setHosts] = useState<PublishHostStatus[]>([]);
	const [target, setTarget] = useState<PublishTarget | null>(null);
	const [pages, setPages] = useState<PagesStatus | null>(null);
	const [branch, setBranch] = useState(DEFAULT_PAGES_BRANCH);
	const [host, setHost] = useState<PublishHost>(pickedHost);
	const [token, setToken] = useState("");
	const [locked, setLocked] = useState(false);
	const [password, setPassword] = useState("");
	const [expires, setExpires] = useState(false);
	const [date, setDate] = useState(() => localDate(daysFrom(new Date(), DEFAULT_EXPIRY_DAYS)));
	const [busy, setBusy] = useState<Busy>("load");
	const [copied, setCopied] = useState(false);
	const [copiedPassword, setCopiedPassword] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const fieldRef = useRef<HTMLInputElement>(null);
	const passwordRef = useRef<HTMLInputElement>(null);

	const screenCount = useMemo(
		() => shareScreens(frames, files, sections, theme).length,
		[frames, files, sections, theme],
	);

	const drafts = draftedSections(sections);
	const info = PUBLISH_HOST_INFO[host];
	const viaGit = host === "github";
	const ready = pages?.state === "ready" ? pages : null;
	const connected = viaGit ? !!ready : hosts.some((status) => status.host === host && status.connected);
	const reconnect = viaGit ? "Set up git sync with the same GitHub remote" : `Connect ${info.name} again`;
	const [openedAt] = useState(() => Date.now());
	const minDate = localDate(new Date(openedAt));

	const showTarget = useCallback((next: PublishTarget | null) => {
		setTarget(next);

		if (!next) return;
		setHost(next.host);
		setLocked(next.locked);
		setExpires(!!next.expiresAt);

		if (next.expiresAt) setDate(expiryDay(next.expiresAt));
	}, []);

	useEffect(() => {
		let cancelled = false;

		Promise.all([
			api.publishHosts({}),
			api.publishTarget({ path: projectPath }),
			api.publishPages({ path: projectPath }),
		])
			.then(([nextHosts, nextTarget, nextPages]) => {
				if (cancelled) return;
				setHosts(nextHosts);
				setPages(nextPages);
				showTarget(nextTarget);
			})
			.catch((error) => {
				if (!cancelled) toast.error("Couldn't read the published site", { description: errorMessage(error) });
			})
			.finally(() => !cancelled && setBusy(null));

		return () => {
			cancelled = true;
		};
	}, [projectPath, showTarget]);

	const connect = async () => {
		if (!isTokenHost(host)) return;
		setBusy("connect");

		try {
			setHosts(await api.publishConnect({ host, token }));
			setToken("");
			toast.success(`${info.name} connected`);
		} catch (error) {
			toast.error(`Couldn't connect ${info.name}`, { description: errorMessage(error) });
		} finally {
			setBusy(null);
		}
	};

	const disconnect = async () => {
		if (!isTokenHost(host)) return;
		setBusy("disconnect");

		try {
			setHosts(await api.publishDisconnect({ host }));

			toast(`${info.name} disconnected`, {
				description:
					target?.host === host && target.expiresAt
						? "The token is gone from the keychain. Sites stay up, and Rabisco can't remove this one when it expires."
						: "The token is gone from the keychain. Sites stay up.",
			});
		} catch (error) {
			toast.error(`Couldn't disconnect ${info.name}`, { description: errorMessage(error) });
		} finally {
			setBusy(null);
		}
	};

	const publish = async () => {
		setBusy("publish");

		const request = buildShareSnapshot({
			name: projectName,
			frames,
			sections,
			files,
			theme,
			start: selected[0]?.file,
		}).then((snapshot) =>
			api.publishSite({
				path: projectPath,
				host,
				snapshot,
				password: locked ? password : undefined,
				expiresAt: expires ? expiryFromDate(date) : undefined,
				branch: viaGit ? branch : undefined,
			}),
		);

		const copying = target ? null : copyLater(request.then((next) => next.url));

		const sentPassword = locked ? password : "";

		const action = sentPassword
			? { label: "Copy password", onClick: () => void copyPassword(sentPassword) }
			: undefined;

		const live = viaGit ? " GitHub can take a minute to show it." : "";

		try {
			const next = await request;

			if (target)
				toast.success("Site updated", {
					description: `People with the link see the latest screens.${live}`,
					action,
				});
			else {
				const done = (await copying) ?? false;
				toast.success(done ? "Site published and link copied" : "Site published", {
					description: `${next.url}${live}`,
					action,
				});
			}

			showTarget(next);
		} catch (error) {
			toast.error("Couldn't publish the site", { description: errorMessage(error) });
		} finally {
			setBusy(null);
		}
	};

	const remove = async () => {
		setConfirmRemove(false);
		setBusy("remove");

		try {
			await api.unpublishSite({ path: projectPath });
			setTarget(null);
			toast("Site removed", {
				description: viaGit
					? "The link shows a page that says the site was removed."
					: `The link doesn't work anymore. ${info.name} deleted the site.`,
			});
		} catch (error) {
			toast.error("Couldn't remove the site", { description: errorMessage(error) });
		} finally {
			setBusy(null);
		}
	};

	const copyPassword = async (value: string) => {
		const field = passwordRef.current?.value === value ? passwordRef.current : null;

		if (await copyText(value, field)) {
			setCopiedPassword(true);
			setTimeout(() => setCopiedPassword(false), 1500);
		} else toast.error("Couldn't copy the password");
	};

	const lock = (next: boolean) => {
		setLocked(next);

		if (next && !password) setPassword(generatePassphrase());
	};

	const copy = async () => {
		if (!target) return;

		if (await copyText(target.url, fieldRef.current)) {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} else toast.error("Couldn't copy the link");
	};

	if (!isDesktop) return <p className="text-xs text-muted-foreground">{DESKTOP_ONLY}</p>;

	if (busy === "load")
		return (
			<p className="flex items-center gap-2 text-xs text-muted-foreground">
				<LoaderCircle className="size-3.5 motion-safe:animate-spin" />
				Checking the published site…
			</p>
		);

	const noScreens = screenCount === 0;
	const weakPassword = locked && password.length < MIN_PASSWORD_LENGTH;
	const canPublish = connected && busy === null && !noScreens && !weakPassword && (!expires || date >= minDate);
	const expired = !!target?.expiresAt && Date.parse(target.expiresAt) <= openedAt;
	const lastDay = target?.expiresAt ? shortDate(expiryDay(target.expiresAt)) : null;
	const reach = target?.locked ? "Anyone with the link and the password" : "Anyone with the link";

	const summary = expired
		? `The link stopped working after ${lastDay}. ${connected ? "Rabisco removes the site at its next check." : `${reconnect} to remove it.`}`
		: `${reach} can open it on any device${lastDay ? ` until the end of ${lastDay}` : ""}.`;

	return (
		<div className="flex flex-col gap-3">
			{target ? (
				<>
					<div className="flex items-center gap-1">
						<Input
							ref={fieldRef}
							readOnly
							value={target.url}
							aria-label="Published link"
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
									.openExternal({ url: target.url })
									.catch((error) => toast.error("Couldn't open the link", { description: errorMessage(error) }))
							}
						>
							<ExternalLink />
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						{`${target.screens} ${target.screens === 1 ? "screen" : "screens"} on ${info.name}, updated ${timeAgo(target.publishedAt)}. `}
						{summary}
					</p>
					{target.host === "github" ? (
						<PagesNote
							text={`From the ${target.siteId} branch of ${target.siteName}. If the link shows a 404, turn on Pages for that branch in the repository settings.`}
							settingsUrl={ready?.repo === target.siteName ? ready.settingsUrl : null}
						/>
					) : null}
				</>
			) : (
				<>
					<p className="text-[13px] text-muted-foreground">
						Put the screens on the web with your own host account, for a link that works anywhere and stays up when
						Rabisco is closed.
					</p>
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						value={host}
						onValueChange={(value) => {
							if (!isPublishHost(value)) return;
							pickedHost = value;
							setHost(value);
						}}
						aria-label="Host"
						className="self-start"
					>
						{PUBLISH_HOSTS.map((option) => (
							<ToggleGroupItem key={option} value={option} className="px-3 text-[13px]">
								{PUBLISH_HOST_INFO[option].name}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</>
			)}

			{viaGit && ready && !target ? (
				<div className="flex flex-col gap-2">
					<Label htmlFor="publish-branch" className="text-[13px] font-normal">
						Branch
					</Label>
					<Input
						id="publish-branch"
						value={branch}
						onChange={(event) => setBranch(event.target.value)}
						autoComplete="off"
						spellCheck={false}
						className="h-8 font-mono text-xs"
					/>
					<PagesNote
						text={`Rabisco pushes the site to this branch of ${ready.repo} with your git credentials, at ${ready.url}. Turn on Pages for the branch once in the repository settings. Anyone who can read the repository can read the project, whatever the password.`}
						settingsUrl={ready.settingsUrl}
					/>
				</div>
			) : null}

			{connected || target ? (
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-2">
							<Label htmlFor="publish-password" className="text-[13px] font-normal">
								Password
							</Label>
							<Switch id="publish-password" size="sm" checked={locked} onCheckedChange={lock} />
						</div>
						{locked ? (
							<>
								<div className="flex items-center gap-1">
									<Input
										ref={passwordRef}
										value={password}
										onChange={(event) => setPassword(event.target.value)}
										placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
										aria-label="Password for the link"
										autoComplete="off"
										spellCheck={false}
										className="h-8 font-mono text-xs"
									/>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="Copy password"
										title="Copy password"
										disabled={!password}
										onClick={() => void copyPassword(password)}
									>
										{copiedPassword ? <Check /> : <Copy />}
									</Button>
									<Button size="sm" variant="ghost" onClick={() => setPassword(generatePassphrase())}>
										Generate
									</Button>
								</div>
								<p className="text-xs text-muted-foreground">
									The design is encrypted and viewers type the password to open it. Rabisco doesn't keep it, so type it
									again for each update. Send it apart from the link.
								</p>
							</>
						) : target?.locked ? (
							<p className="text-xs text-muted-foreground">
								Updating removes the password. Anyone with the link can open it.
							</p>
						) : null}
					</div>

					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-2">
							<Label htmlFor="publish-expires" className="text-[13px] font-normal">
								Expires
							</Label>
							<Switch id="publish-expires" size="sm" checked={expires} onCheckedChange={setExpires} />
						</div>
						{expires ? (
							<>
								<Input
									type="date"
									value={date}
									min={minDate}
									onChange={(event) => setDate(event.target.value)}
									aria-label="Expiry date"
									className="h-8 text-xs"
								/>
								<p className="text-xs text-muted-foreground">
									The link works through this day. Rabisco removes the site the next time it runs after it.
								</p>
							</>
						) : null}
					</div>

					{confirmRemove ? (
						<div className="flex flex-col gap-2">
							<p className="text-xs text-muted-foreground">
								{viaGit
									? "Rabisco replaces the site with a page that says it was removed. Earlier versions stay in the branch's history on GitHub."
									: `${info.name} deletes the site and every link you sent stops working. Publishing again makes a new link.`}
							</p>
							<div className="flex items-center gap-2">
								<Button size="sm" variant="destructive" onClick={remove} disabled={busy !== null}>
									Unpublish
								</Button>
								<Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
									Cancel
								</Button>
							</div>
						</div>
					) : (
						<div className="flex items-center gap-2">
							<Button size="sm" onClick={publish} disabled={!canPublish || (viaGit && !target && !branch.trim())}>
								{busy === "publish" ? <LoaderCircle className="motion-safe:animate-spin" /> : <Globe />}
								{target ? "Update site" : `Publish to ${info.name}`}
							</Button>
							{target ? (
								<Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)} disabled={busy !== null}>
									{busy === "remove" ? <LoaderCircle className="motion-safe:animate-spin" /> : null}
									Unpublish…
								</Button>
							) : null}
						</div>
					)}
					{target && !connected && !expired ? (
						<p className="text-xs text-muted-foreground">{reconnect} to update or remove this site.</p>
					) : null}
				</div>
			) : null}

			{connected ? null : viaGit ? (
				<div className="flex flex-col gap-2">
					<p className="text-xs text-muted-foreground">
						{pages?.state === "setup"
							? `${PAGES_SETUP[pages.step]} ${info.planHint} Rabisco uses your git credentials and keeps no token.`
							: pages?.state === "unavailable"
								? pages.error
								: null}
					</p>
					{pages?.state === "setup" && pages.remoteUrl ? (
						<p className="truncate font-mono text-xs text-muted-foreground">{pages.remoteUrl}</p>
					) : null}
					{pages?.state === "setup" ? (
						<Button size="sm" variant="outline" className="self-start" onClick={onOpenGit}>
							<GitBranch />
							Set up git sync
						</Button>
					) : null}
				</div>
			) : (
				<div className="flex flex-col gap-2">
					<p className="text-xs text-muted-foreground">
						Rabisco publishes to your own {info.name} account. {info.planHint} {TOKEN_HOST_INFO[host].tokenHint} The
						token stays in this computer's keychain.
					</p>
					<div className="flex items-center gap-1">
						<Input
							type="password"
							value={token}
							onChange={(event) => setToken(event.target.value)}
							placeholder={`${info.name} token`}
							aria-label={`${info.name} token`}
							autoComplete="off"
							className="h-8 font-mono text-xs"
						/>
						<Button size="sm" variant="outline" onClick={connect} disabled={busy !== null || !token.trim()}>
							{busy === "connect" ? <LoaderCircle className="motion-safe:animate-spin" /> : null}
							Connect
						</Button>
					</div>
					<Button
						size="sm"
						variant="link"
						className="h-auto self-start p-0 text-xs"
						onClick={() =>
							api
								.openExternal({ url: TOKEN_HOST_INFO[host].tokenUrl })
								.catch((error) => toast.error("Couldn't open the page", { description: errorMessage(error) }))
						}
					>
						Get a {info.name} token
						<ExternalLink />
					</Button>
				</div>
			)}

			{connected && !viaGit ? (
				<Button
					size="sm"
					variant="link"
					className="h-auto self-start p-0 text-xs text-muted-foreground"
					onClick={disconnect}
					disabled={busy !== null}
				>
					Disconnect {info.name}
				</Button>
			) : null}

			{noScreens ? <p className="text-xs text-muted-foreground">Add a screen to publish it.</p> : null}
			{drafts ? (
				<p className="text-xs text-muted-foreground">
					{drafts === 1 ? "1 section has" : `${drafts} sections have`} draft tokens that won’t be published.
				</p>
			) : null}
		</div>
	);
}

function PagesNote({ text, settingsUrl }: { text: string; settingsUrl: string | null }) {
	return (
		<>
			<p className="text-xs text-muted-foreground">{text}</p>
			{settingsUrl ? (
				<Button
					size="sm"
					variant="link"
					className="h-auto self-start p-0 text-xs"
					onClick={() =>
						api
							.openExternal({ url: settingsUrl })
							.catch((error) => toast.error("Couldn't open the page", { description: errorMessage(error) }))
					}
				>
					Open Pages settings
					<ExternalLink />
				</Button>
			) : null}
		</>
	);
}
