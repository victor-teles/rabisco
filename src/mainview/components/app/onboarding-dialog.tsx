import { useState } from "react";
import { toast } from "sonner";
import { Check, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { openSettings, selectModel, upsertStatus, useProviders } from "@/hooks/use-providers";
import { preselectProvider } from "@/lib/onboarding";
import { api } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { PROVIDER_TYPES, toModelRef, type ProviderStatus, type ProviderType } from "../../../shared/ai/settings";

const SEEN_KEY = "rabisco:onboarded";

function wasSeen() {
	try {
		return localStorage.getItem(SEEN_KEY) === "1";
	} catch {
		return false;
	}
}

function markSeen() {
	try {
		localStorage.setItem(SEEN_KEY, "1");
	} catch {
		// Private mode: it shows again next launch
	}
}

/** `config:<id>` for a provider in the settings, `type:<type>` for one to add */
type Choice = `config:${string}` | `type:${ProviderType}`;

const KIND_LABEL = { api: "API", cli: "CLI", sdk: "SDK" } as const;

function statusLine(status: ProviderStatus | undefined) {
	if (!status?.health) return "Checking…";

	return status.health.ok ? "Ready" : status.health.message;
}

/** Shown once, on the first launch without a default model. Every path out of it, Esc included, counts as seen. */
export function OnboardingDialog() {
	const { loading, settings, statuses, settingsOpen } = useProviders();
	const [seen, setSeen] = useState(wasSeen);
	const [picked, setPicked] = useState<Choice | null>(null);
	const [working, setWorking] = useState(false);
	const open = !seen && !loading && !settings.defaultModel && !settingsOpen;

	const preselected = preselectProvider(settings.providers, statuses);
	const choice: Choice | null = picked ?? (preselected ? `config:${preselected}` : null);
	const added = new Set(settings.providers.map((p) => p.type));
	const addable = PROVIDER_TYPES.filter((t) => t.type === "openai-compatible" || !added.has(t.type));

	const finish = () => {
		markSeen();
		setSeen(true);
	};

	const adopt = (status: ProviderStatus, defaultModel?: string) => {
		const model = defaultModel ?? status.models[0]?.id;

		if (status.health?.ok && model) {
			selectModel(toModelRef(status.id, model));
			toast.success(`${status.label} is ready`, { description: "Describe an app to draft its first screens." });
		} else openSettings(status.id);
	};

	const start = async () => {
		if (!choice) return finish();
		setWorking(true);

		try {
			if (choice.startsWith("config:")) {
				const id = choice.slice("config:".length);
				const status = statuses.find((s) => s.id === id);
				const config = settings.providers.find((p) => p.id === id);
				finish();

				if (status) adopt(status, config?.defaultModel);
				else openSettings(id);

				return;
			}

			const info = PROVIDER_TYPES.find((t) => `type:${t.type}` === choice);

			if (!info) return finish();
			const status = await api.addProvider({ type: info.type });
			upsertStatus(status);
			finish();

			// Keys and endpoints are typed in Settings, which stores keys in the keychain
			if (info.needsKey || info.needsBaseUrl) openSettings(status.id);
			else adopt(status);
		} catch (error) {
			toast.error("Couldn't set up the provider", { description: String(error) });
		} finally {
			setWorking(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && finish()}>
			<DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
				<DialogHeader className="px-6 pt-6 pb-4">
					<DialogTitle>Welcome to Rabisco</DialogTitle>
					<DialogDescription>
						Pick the AI that drafts your screens. You can open and edit designs without one, and change it later in
						Settings.
					</DialogDescription>
				</DialogHeader>

				<ScrollArea className="min-h-0 flex-1 border-y">
					<div role="radiogroup" aria-label="AI provider" className="flex flex-col gap-1 px-4 py-3">
						{settings.providers.length ? (
							<>
								<GroupLabel>Found on this computer</GroupLabel>
								{settings.providers.map((config) => {
									const status = statuses.find((s) => s.id === config.id);
									const info = PROVIDER_TYPES.find((t) => t.type === config.type);

									return (
										<Option
											key={config.id}
											label={config.label}
											kind={info?.kind}
											hint={statusLine(status)}
											warn={status?.health?.ok === false}
											checked={choice === `config:${config.id}`}
											onSelect={() => setPicked(`config:${config.id}`)}
										/>
									);
								})}
							</>
						) : null}
						<GroupLabel>{settings.providers.length ? "Or connect another" : "Connect a provider"}</GroupLabel>
						{addable.map((info) => (
							<Option
								key={info.type}
								label={info.label}
								kind={info.kind}
								hint={info.description}
								checked={choice === `type:${info.type}`}
								onSelect={() => setPicked(`type:${info.type}`)}
							/>
						))}
					</div>
				</ScrollArea>

				<DialogFooter className="px-6 py-4">
					<Button variant="ghost" size="sm" onClick={finish} disabled={working}>
						Start without AI
					</Button>
					<Button size="sm" onClick={() => void start()} disabled={!choice || working}>
						{working ? <LoaderCircle className="motion-safe:animate-spin" /> : null}
						Continue
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function GroupLabel({ children }: { children: React.ReactNode }) {
	return <p className="px-2 pt-2 pb-1 text-xs text-subtle-foreground first:pt-0">{children}</p>;
}

function Option({
	label,
	kind,
	hint,
	warn = false,
	checked,
	onSelect,
}: {
	label: string;
	kind?: keyof typeof KIND_LABEL;
	hint: string;
	warn?: boolean;
	checked: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			role="radio"
			aria-checked={checked}
			onClick={onSelect}
			className={cn(
				"flex items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
				checked && "border-border-strong bg-accent",
			)}
		>
			<span className="min-w-0 flex-1">
				<span className="flex items-center gap-2">
					<span className="truncate text-sm font-medium">{label}</span>
					{kind ? (
						<Badge variant="secondary" className="h-5 px-1.5 text-[11px] text-subtle-foreground">
							{KIND_LABEL[kind]}
						</Badge>
					) : null}
				</span>
				<span className={cn("block truncate text-xs", warn ? "text-destructive" : "text-muted-foreground")}>
					{hint}
				</span>
			</span>
			<Check className={cn("size-4 shrink-0", checked ? "text-foreground" : "invisible")} />
		</button>
	);
}
