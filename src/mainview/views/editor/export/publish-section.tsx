import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Globe, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, DESKTOP_ONLY, isDesktop } from "@/lib/rpc";
import { buildShareSnapshot } from "@/lib/share-snapshot";
import {
	generatePassphrase,
	isPublishHost,
	MIN_PASSWORD_LENGTH,
	PUBLISH_HOST_INFO,
	PUBLISH_HOSTS,
	type PublishHost,
	type PublishHostStatus,
	type PublishTarget,
} from "../../../../shared/share/publish";
import { shareScreens } from "../../../../shared/share/snapshot";
import type { ExportContext } from "./export-menu";
import { copyLater, copyText, daysFrom, errorMessage, expiryFromDate, localDate, timeAgo } from "./share-utils";

type Busy = "load" | "connect" | "disconnect" | "publish" | "remove" | null;

const DEFAULT_EXPIRY_DAYS = 7;

/** Decision 0038: the exported website on a host the user owns */
export function PublishSection({ context }: { context: ExportContext }) {
	const { projectPath, projectName, frames, files, theme, selected } = context;
	const [hosts, setHosts] = useState<PublishHostStatus[]>([]);
	const [target, setTarget] = useState<PublishTarget | null>(null);
	const [host, setHost] = useState<PublishHost>("netlify");
	const [token, setToken] = useState("");
	const [locked, setLocked] = useState(false);
	const [password, setPassword] = useState("");
	const [expires, setExpires] = useState(false);
	const [date, setDate] = useState(() => localDate(daysFrom(new Date(), DEFAULT_EXPIRY_DAYS)));
	const [busy, setBusy] = useState<Busy>("load");
	const [copied, setCopied] = useState(false);
	const fieldRef = useRef<HTMLInputElement>(null);
	const screenCount = useMemo(() => shareScreens(frames, files).length, [frames, files]);
	const info = PUBLISH_HOST_INFO[host];
	const connected = hosts.some((status) => status.host === host && status.connected);
	const [minDate] = useState(() => localDate(daysFrom(new Date(), 1)));

	const showTarget = useCallback((next: PublishTarget | null) => {
		setTarget(next);

		if (!next) return;
		setHost(next.host);
		setLocked(next.locked);
		setExpires(!!next.expiresAt);

		if (next.expiresAt) setDate(localDate(new Date(next.expiresAt)));
	}, []);

	useEffect(() => {
		let cancelled = false;

		Promise.all([api.publishHosts({}), api.publishTarget({ path: projectPath })])
			.then(([nextHosts, nextTarget]) => {
				if (cancelled) return;
				setHosts(nextHosts);
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
		setBusy("disconnect");

		try {
			setHosts(await api.publishDisconnect({ host }));
			toast(`${info.name} disconnected`, { description: "The token is gone from the keychain. Sites stay up." });
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
			}),
		);

		const copying = target ? null : copyLater(request.then((next) => next.url));

		try {
			const next = await request;
			setPassword("");

			if (target) toast.success("Site updated", { description: "People with the link see the latest screens." });
			else {
				const done = (await copying) ?? false;
				toast.success(done ? "Site published and link copied" : "Site published", { description: next.url });
			}

			showTarget(next);
		} catch (error) {
			toast.error("Couldn't publish the site", { description: errorMessage(error) });
		} finally {
			setBusy(null);
		}
	};

	const remove = async () => {
		setBusy("remove");

		try {
			await api.unpublishSite({ path: projectPath });
			setTarget(null);
			toast("Site removed", { description: `The link doesn't work anymore. ${info.name} deleted the site.` });
		} catch (error) {
			toast.error("Couldn't remove the site", { description: errorMessage(error) });
		} finally {
			setBusy(null);
		}
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
						{target.locked
							? "Anyone with the link and the password can open it, on any device."
							: "Anyone with the link can open it, on any device."}
					</p>
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
							if (isPublishHost(value)) setHost(value);
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

			{connected || target ? (
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-2">
							<Label htmlFor="publish-password" className="text-[13px] font-normal">
								Password
							</Label>
							<Switch id="publish-password" size="sm" checked={locked} onCheckedChange={setLocked} />
						</div>
						{locked ? (
							<>
								<div className="flex items-center gap-1">
									<Input
										value={password}
										onChange={(event) => setPassword(event.target.value)}
										placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
										aria-label="Password for the link"
										autoComplete="off"
										spellCheck={false}
										className="h-8 font-mono text-xs"
									/>
									<Button size="sm" variant="ghost" onClick={() => setPassword(generatePassphrase())}>
										Generate
									</Button>
								</div>
								<p className="text-xs text-muted-foreground">
									The design is encrypted and viewers type the password to open it. Rabisco doesn't keep it, so type it
									again for each update. Send it apart from the link.
								</p>
							</>
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
									The link stops working on this date. Rabisco removes the site the next time it runs after it.
								</p>
							</>
						) : null}
					</div>

					<div className="flex items-center gap-2">
						<Button size="sm" onClick={publish} disabled={!canPublish}>
							{busy === "publish" ? <LoaderCircle className="motion-safe:animate-spin" /> : <Globe />}
							{target ? "Update site" : `Publish to ${info.name}`}
						</Button>
						{target ? (
							<Button size="sm" variant="ghost" onClick={remove} disabled={busy !== null}>
								{busy === "remove" ? <LoaderCircle className="motion-safe:animate-spin" /> : null}
								Unpublish
							</Button>
						) : null}
					</div>
					{target && !connected ? (
						<p className="text-xs text-muted-foreground">Connect {info.name} again to update or remove this site.</p>
					) : null}
				</div>
			) : null}

			{connected ? null : (
				<div className="flex flex-col gap-2">
					<p className="text-xs text-muted-foreground">
						Rabisco publishes to your own {info.name} account, free on its starter plan. {info.tokenHint} The token
						stays in this computer's keychain.
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
								.openExternal({ url: info.tokenUrl })
								.catch((error) => toast.error("Couldn't open the page", { description: errorMessage(error) }))
						}
					>
						Get a {info.name} token
						<ExternalLink />
					</Button>
				</div>
			)}

			{connected ? (
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
		</div>
	);
}
