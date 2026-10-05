import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ExternalLink, KeyRound, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { closeSettings, loadProviders, removeStatus, upsertStatus, useProviders } from "@/hooks/use-providers";
import { api } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import {
	PROVIDER_TYPES,
	type ProviderConfig,
	type ProviderStatus,
	type ProviderTypeInfo,
} from "../../../shared/ai/settings";

const KIND_LABEL = { api: "API", cli: "CLI", sdk: "SDK" } as const;

const typeInfo = (type: string) => PROVIDER_TYPES.find((t) => t.type === type);

export function SettingsDialog() {
	const { settingsOpen, focusProvider, settings, statuses, loading } = useProviders();
	const [expanded, setExpanded] = useState(settingsOpen ? focusProvider : null);
	const [refreshing, setRefreshing] = useState(false);
	// Opening (or asking for another provider while open) expands the provider asked for
	const [request, setRequest] = useState({ open: settingsOpen, focus: focusProvider });

	if (request.open !== settingsOpen || request.focus !== focusProvider) {
		setRequest({ open: settingsOpen, focus: focusProvider });

		if (settingsOpen) setExpanded(focusProvider);
	}

	const added = new Set(settings.providers.map((p) => p.type));
	const addable = PROVIDER_TYPES.filter((t) => t.type === "openai-compatible" || !added.has(t.type));

	const add = async (info: ProviderTypeInfo) => {
		try {
			const status = await api.addProvider({ type: info.type });
			upsertStatus(status);
			setExpanded(status.id);
		} catch (error) {
			toast.error(`Couldn't add ${info.label}`, { description: String(error) });
		}
	};

	const refresh = async () => {
		setRefreshing(true);
		await loadProviders(true);
		setRefreshing(false);
	};

	return (
		<Dialog open={settingsOpen} onOpenChange={(open) => !open && closeSettings()}>
			<DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
				<DialogHeader className="border-b px-6 pt-6 pb-4">
					<DialogTitle>AI providers</DialogTitle>
					<DialogDescription>
						Bring your own AI: an API key, a CLI you are already logged in to, or a local model. Keys stay in your
						system keychain.
					</DialogDescription>
				</DialogHeader>

				<ScrollArea className="min-h-0 flex-1">
					<div className="flex flex-col gap-2 px-6 py-4">
						{loading && !settings.providers.length ? (
							<p className="py-8 text-center text-sm text-muted-foreground">Checking providers…</p>
						) : settings.providers.length === 0 ? (
							<div className="rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
								No providers yet. Add one to start generating screens.
							</div>
						) : (
							settings.providers.map((config) => (
								<ProviderCard
									key={config.id}
									config={config}
									status={statuses.find((s) => s.id === config.id)}
									open={expanded === config.id}
									onOpenChange={(open) => setExpanded(open ? config.id : null)}
								/>
							))
						)}
					</div>
				</ScrollArea>

				<div className="flex items-center gap-2 border-t px-6 py-3">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size="sm">
								<Plus />
								Add provider
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" side="top" className="w-72">
							{(["api", "cli", "sdk"] as const).map((kind, index) => {
								const items = addable.filter((t) => t.kind === kind);

								if (!items.length) return null;

								return (
									<div key={kind}>
										{index > 0 ? <DropdownMenuSeparator /> : null}
										<DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
											{kind === "api" ? "API key or endpoint" : kind === "cli" ? "Command-line agent" : "Agent SDK"}
										</DropdownMenuLabel>
										{items.map((info) => (
											<DropdownMenuItem
												key={info.type}
												onSelect={() => add(info)}
												className="flex-col items-start gap-0"
											>
												<span className="text-[13px]">{info.label}</span>
												<span className="text-xs text-muted-foreground">{info.description}</span>
											</DropdownMenuItem>
										))}
									</div>
								);
							})}
						</DropdownMenuContent>
					</DropdownMenu>
					<div className="flex-1" />
					<Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing}>
						<RefreshCw className={cn(refreshing && "motion-safe:animate-spin")} />
						Check all
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function HealthDot({ status, testing }: { status?: ProviderStatus; testing: boolean }) {
	if (testing || !status?.health)
		return <LoaderCircle className="size-3.5 text-muted-foreground motion-safe:animate-spin" />;

	return (
		<span
			aria-hidden="true"
			className={cn(
				"size-2 rounded-full",
				!status.enabled ? "bg-border-strong" : status.health.ok ? "bg-success" : "bg-destructive",
			)}
		/>
	);
}

function statusText(status: ProviderStatus | undefined, testing: boolean) {
	if (testing || !status?.health) return "Checking…";

	if (!status.enabled) return "Disabled";

	if (!status.health.ok) return status.health.message;
	const count = `${status.models.length} ${status.models.length === 1 ? "model" : "models"}`;

	return status.health.version ? `Ready · ${status.health.version} · ${count}` : `Ready · ${count}`;
}

function ProviderCard({
	config,
	status,
	open,
	onOpenChange,
}: {
	config: ProviderConfig;
	status?: ProviderStatus;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const info = typeInfo(config.type);
	const [testing, setTesting] = useState(false);
	const [key, setKey] = useState("");
	const [baseUrl, setBaseUrl] = useState(config.baseUrl ?? "");
	const [binPath, setBinPath] = useState(config.binPath ?? "");
	const [label, setLabel] = useState(config.label);
	const keyRef = useRef<HTMLInputElement>(null);
	const health = status?.health;

	useEffect(() => {
		if (open && info?.needsKey && !config.hasKey) requestAnimationFrame(() => keyRef.current?.focus());
	}, [open, info?.needsKey, config.hasKey]);

	const run = async (action: () => Promise<ProviderStatus>, failure: string) => {
		setTesting(true);

		try {
			upsertStatus(await action());
		} catch (error) {
			toast.error(failure, { description: String(error) });
		} finally {
			setTesting(false);
		}
	};

	const save = () =>
		run(
			() =>
				api.updateProvider({
					id: config.id,
					patch: {
						label: label.trim() || config.label,
						baseUrl: baseUrl.trim() || undefined,
						binPath: binPath.trim() || undefined,
					},
					apiKey: key.trim() ? key.trim() : undefined,
				}),
			"Couldn't save the provider",
		).then(() => setKey(""));

	const dirty =
		key.trim() !== "" ||
		label !== config.label ||
		baseUrl !== (config.baseUrl ?? "") ||
		binPath !== (config.binPath ?? "");

	const remove = async () => {
		try {
			await api.removeProvider({ id: config.id });
			removeStatus(config.id);
		} catch (error) {
			toast.error("Couldn't remove the provider", { description: String(error) });
		}
	};

	return (
		<Collapsible open={open} onOpenChange={onOpenChange} className="rounded-xl border bg-card">
			<CollapsibleTrigger asChild>
				<button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left">
					<HealthDot status={status} testing={testing} />
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<span className="truncate text-sm font-medium">{config.label}</span>
							{info ? (
								<Badge variant="secondary" className="h-5 px-1.5 text-[11px] text-subtle-foreground">
									{KIND_LABEL[info.kind]}
								</Badge>
							) : null}
						</div>
						<p
							className={cn(
								"truncate text-xs",
								health && !health.ok && config.enabled ? "text-destructive" : "text-muted-foreground",
							)}
						>
							{statusText(status, testing)}
						</p>
					</div>
					<ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
				</button>
			</CollapsibleTrigger>

			<CollapsibleContent>
				<div className="flex flex-col gap-3 border-t px-4 py-4">
					{health && !health.ok && health.fix ? (
						<div className="flex items-start gap-3 rounded-lg bg-destructive/8 px-3 py-2.5 text-[13px]">
							<p className="flex-1">{health.fix}</p>
							{info?.helpUrl ? <HelpLink url={info.helpUrl} kind={info.kind} /> : null}
						</div>
					) : null}

					<Field label="Name">
						<Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8" />
					</Field>

					{info?.needsKey || config.type === "openai-compatible" ? (
						<Field
							label="API key"
							hint={config.hasKey ? "Stored in your keychain. Type a new key to replace it." : undefined}
						>
							<div className="flex gap-2">
								<Input
									ref={keyRef}
									type="password"
									autoComplete="off"
									spellCheck={false}
									placeholder={config.hasKey ? "••••••••••••" : info?.needsKey ? "Paste your key" : "Optional"}
									value={key}
									onChange={(e) => setKey(e.target.value)}
									onKeyDown={(e) => e.key === "Enter" && dirty && save()}
									className="h-8 font-mono"
								/>
								{config.hasKey ? (
									<Button
										variant="ghost"
										size="sm"
										onClick={() =>
											run(
												() => api.updateProvider({ id: config.id, patch: {}, apiKey: null }),
												"Couldn't remove the key",
											)
										}
									>
										<KeyRound />
										Forget
									</Button>
								) : info?.helpUrl ? (
									<HelpLink url={info.helpUrl} kind={info.kind} />
								) : null}
							</div>
						</Field>
					) : null}

					{info?.kind === "api" ? (
						<Field label="Base URL" hint={info.needsBaseUrl ? undefined : `Default: ${info.defaultBaseUrl}`}>
							<Input
								value={baseUrl}
								placeholder={info.defaultBaseUrl ?? "http://localhost:1234/v1"}
								onChange={(e) => setBaseUrl(e.target.value)}
								className="h-8 font-mono"
							/>
						</Field>
					) : null}

					{info?.kind === "cli" ? (
						<Field label="Binary path" hint="Leave empty to find it on your PATH.">
							<Input
								value={binPath}
								placeholder={config.type === "claude-code" ? "claude" : config.type === "codex" ? "codex" : "gemini"}
								onChange={(e) => setBinPath(e.target.value)}
								className="h-8 font-mono"
							/>
						</Field>
					) : null}

					{status?.models.length ? (
						<Field label="Default model">
							<select
								value={config.defaultModel ?? ""}
								onChange={(e) =>
									run(
										() => api.updateProvider({ id: config.id, patch: { defaultModel: e.target.value || undefined } }),
										"Couldn't save the default model",
									)
								}
								className="h-8 rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30"
							>
								<option value="">First available</option>
								{status.models.map((m) => (
									<option key={m.id} value={m.id}>
										{m.label}
									</option>
								))}
							</select>
						</Field>
					) : null}

					<div className="flex items-center gap-2 pt-1">
						<Button size="sm" onClick={save} disabled={!dirty || testing}>
							Save
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => run(() => api.testProvider({ id: config.id }), "Couldn't test the provider")}
							disabled={testing}
						>
							Test connection
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								run(
									() => api.updateProvider({ id: config.id, patch: { enabled: !config.enabled } }),
									"Couldn't update the provider",
								)
							}
						>
							{config.enabled ? "Disable" : "Enable"}
						</Button>
						<div className="flex-1" />
						<Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={remove}>
							<Trash2 />
							Remove
						</Button>
					</div>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-xs font-medium text-muted-foreground">{label}</span>
			{children}
			{hint ? <span className="text-xs text-subtle-foreground">{hint}</span> : null}
		</label>
	);
}

function HelpLink({ url, kind }: { url: string; kind: ProviderTypeInfo["kind"] }) {
	return (
		<Button variant="ghost" size="sm" className="shrink-0" onClick={() => void api.openExternal({ url })}>
			<ExternalLink />
			{kind === "cli" ? "Install" : "Get a key"}
		</Button>
	);
}
