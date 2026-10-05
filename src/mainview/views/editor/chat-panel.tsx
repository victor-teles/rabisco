import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { AlertCircle, Crosshair, MessageSquareText, Sparkles, X } from "lucide-react";
import { DesignComposer, DeviceToggle, ModelPicker, VariationsPicker } from "@/components/app/design-composer";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Message,
	MessageAvatar,
	MessageBody,
	MessageContent,
} from "@/components/ui/uai/message";
import {
	Thinking,
	ThinkingActivity,
	ThinkingContent,
	ThinkingTrigger,
} from "@/components/ui/uai/thinking";
import { openSettings, useProviders } from "@/hooks/use-providers";
import type { Generation } from "@/hooks/use-generation";
import type { Interview } from "@/hooks/use-interview";
import { api } from "@/lib/rpc";
import { PROVIDER_TYPES } from "../../../shared/ai/settings";
import type { ChatMessage, ContextFileName, Device, GenerationFailure } from "../../../shared/types";

type ChatPanelProps = {
	messages: ChatMessage[];
	generation: Generation | null;
	failure: GenerationFailure | null;
	device: Device;
	onDeviceChange: (device: Device) => void;
	onSend: (prompt: string, files: File[]) => void;
	onStop: () => void;
	onRetry: () => void;
	onDismissFailure: () => void;
	selectedScreenName?: string;
	/** How many screens a prompt would edit; with any, the variations count doesn't apply */
	editingCount: number;
	/** Point and prompt: the selected element a prompt would edit (`<Button> “Get started”`), shown as a chip */
	focusLabel?: string;
	/** Clears the selected element, so prompts edit the whole screen again */
	onClearFocus?: () => void;
	variations: number;
	onVariationsChange: (variations: number) => void;
	/** Opens the Context tab on a file named under a reply */
	onOpenContext: (file: ContextFileName) => void;
	/** The PRODUCT.md interview, while it runs: the composer sends answers */
	interview: Interview | null;
	onStartInterview: () => void;
	onSkipQuestion: () => void;
	onCancelInterview: () => void;
};

const TASK_TITLE = { create: "Designing", edit: "Editing", repair: "Fixing", context: "Writing", vary: "Varying" } as const;

function generationTitle(generation: Generation) {
	if (generation.attempt > 1) return "Fixing problems";
	const title = TASK_TITLE[generation.task];
	return generation.variations > 1 ? `${title} · ${generation.variations} variations` : title;
}

export function ChatPanel({
	messages,
	generation,
	failure,
	device,
	onDeviceChange,
	onSend,
	onStop,
	onRetry,
	onDismissFailure,
	selectedScreenName,
	editingCount,
	focusLabel,
	onClearFocus,
	variations,
	onVariationsChange,
	onOpenContext,
	interview,
	onStartInterview,
	onSkipQuestion,
	onCancelInterview,
}: ChatPanelProps) {
	const endRef = useRef<HTMLDivElement>(null);
	const files = generation ? Object.entries(generation.writing) : [];

	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
	}, [messages.length, generation?.steps.length, files.length, failure]);

	// Answers go through the composer, so put the caret there when the interview starts
	const interviewing = interview !== null;
	const composerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (interviewing) composerRef.current?.querySelector<HTMLTextAreaElement>('[data-slot="prompt-composer-input"]')?.focus();
	}, [interviewing]);

	return (
		<aside className="flex w-[340px] shrink-0 flex-col border-r bg-background">
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col gap-5 px-4 py-5">
					{messages.length === 0 && !generation ? (
						<div className="flex flex-col items-center px-4 pt-16 text-center">
							<span className="grid size-10 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--primary)_14%,var(--card))] text-primary">
								<Sparkles className="size-5" strokeWidth={1.8} />
							</span>
							<p className="mt-4 text-sm font-medium">Start with a description</p>
							<p className="mt-1 text-[13px]/5 text-muted-foreground">
								Tell Rabisco what you're building and who it's for. You can refine each screen
								afterwards.
							</p>
							<Button variant="ghost" size="sm" className="mt-3 text-muted-foreground" onClick={onStartInterview}>
								<MessageSquareText />
								Or start with PRODUCT.md
							</Button>
						</div>
					) : null}

					{messages.map((message) => (
						<Message key={message.id} from={message.role} variant="bubble">
							{message.role === "assistant" ? <MessageAvatar /> : null}
							<MessageBody>
								<MessageContent className="whitespace-pre-wrap">{message.content}</MessageContent>
								{message.role === "assistant" && message.context?.length ? (
									<ContextLine files={message.context} onOpen={onOpenContext} />
								) : null}
							</MessageBody>
						</Message>
					))}

					{generation ? (
						<>
							<Thinking status="thinking">
								<ThinkingTrigger
									title={generationTitle(generation)}
									summary={generation.steps.at(-1)?.label ?? "Starting…"}
								/>
								<ThinkingContent>
									{generation.steps.map((step, index) => (
										<ThinkingActivity key={index} type="progress">
											{step.label}
											{step.detail ? <span className="text-subtle-foreground"> · {step.detail}</span> : null}
										</ThinkingActivity>
									))}
									{files.map(([path, file]) => (
										<ThinkingActivity key={path} type="progress">
											{file.done ? "Wrote" : "Writing"} <span className="font-mono text-xs">{path}</span>
											{file.done ? null : (
												<span className="text-subtle-foreground tabular-nums"> · {file.text.split("\n").length} lines</span>
											)}
										</ThinkingActivity>
									))}
								</ThinkingContent>
							</Thinking>
							{generation.reply.trim() ? (
								<Message from="assistant" variant="bubble">
									<MessageAvatar />
									<MessageBody>
										<MessageContent className="whitespace-pre-wrap">{generation.reply.trim()}</MessageContent>
									</MessageBody>
								</Message>
							) : null}
						</>
					) : null}

					{failure && !generation ? (
						<FailureCard failure={failure} onRetry={onRetry} onDismiss={onDismissFailure} />
					) : null}
					<div ref={endRef} />
				</div>
			</ScrollArea>

			<div ref={composerRef} className="p-3 pt-0">
				{interview ? (
					<InterviewBar step={interview.step} total={interview.total} onSkip={onSkipQuestion} onCancel={onCancelInterview} />
				) : focusLabel ? (
					<FocusChip label={focusLabel} where={selectedScreenName} onClear={onClearFocus} />
				) : null}
				<DesignComposer
					busy={generation !== null}
					onStop={onStop}
					device={device}
					onDeviceChange={onDeviceChange}
					onSubmit={onSend}
					inlineOptions={false}
					placeholder={
						interview
							? "Type your answer…"
							: focusLabel
								? `Change ${focusLabel}…`
								: selectedScreenName
									? `Change ${selectedScreenName}…`
									: "Describe screens to add…"
					}
				/>
				<div className="mt-1.5 flex items-center gap-1 px-0.5">
					<DeviceToggle device={device} onDeviceChange={onDeviceChange} />
					{interview ? null : (
						<VariationsPicker
							value={variations}
							onChange={onVariationsChange}
							hint={
								editingCount
									? "Prompts edit the selection; variations apply to new screens. For alternates, use Vary this in the inspector."
									: undefined
							}
						/>
					)}
					<ModelPicker />
					{selectedScreenName && !(focusLabel && !interview) ? (
						<span className="ml-auto truncate text-xs text-subtle-foreground">
							Editing <span className="font-medium text-muted-foreground">{selectedScreenName}</span>
						</span>
					) : null}
				</div>
			</div>
		</aside>
	);
}

/** Which context files shaped a reply (principle 5); each opens in the Context tab. */
function ContextLine({ files, onOpen }: { files: ContextFileName[]; onOpen: (file: ContextFileName) => void }) {
	return (
		<p className="text-xs text-subtle-foreground">
			Followed{" "}
			{files.map((file, index) => (
				<Fragment key={file}>
					{index > 0 ? " · " : null}
					<button
						type="button"
						onClick={() => onOpen(file)}
						className="rounded-sm font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
						title={`Open ${file}`}
					>
						{file}
					</button>
				</Fragment>
			))}
		</p>
	);
}

/** Point and prompt: the element the next prompt edits, and × to edit the whole screen again. */
function FocusChip({ label, where, onClear }: { label: string; where?: string; onClear?: () => void }) {
	return (
		<div className="mb-1.5 flex w-fit max-w-full items-center gap-1.5 rounded-md border bg-muted/50 py-0.5 pr-0.5 pl-2 text-xs text-subtle-foreground">
			<Crosshair className="size-3.5 shrink-0" strokeWidth={1.8} />
			<span className="min-w-0 truncate" title={where ? `${label} in ${where}` : label}>
				Editing <span className="font-mono text-[11px] text-foreground">{label}</span>
				{where ? (
					<>
						{" "}in <span className="font-medium text-muted-foreground">{where}</span>
					</>
				) : null}
			</span>
			{onClear ? (
				<Button variant="ghost" size="icon-xs" aria-label="Clear the selected element" title="Edit the whole screen" onClick={onClear}>
					<X />
				</Button>
			) : null}
		</div>
	);
}

function InterviewBar({ step, total, onSkip, onCancel }: { step: number; total: number; onSkip: () => void; onCancel: () => void }) {
	const action = (label: string, onClick: () => void): ReactNode => (
		<button
			type="button"
			onClick={onClick}
			className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
		>
			{label}
		</button>
	);
	return (
		<div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs text-subtle-foreground" aria-live="polite">
			<MessageSquareText className="size-3.5" strokeWidth={1.8} />
			<span>
				Interview · <span className="tabular-nums">{step} of {total}</span>
			</span>
			<span className="ml-auto flex items-center gap-1.5">
				{action("Skip", onSkip)}
				<span aria-hidden>·</span>
				{action("Cancel", onCancel)}
			</span>
		</div>
	);
}

const FAILURE_TITLE: Record<GenerationFailure["code"], string> = {
	not_installed: "The CLI isn't installed",
	not_authenticated: "Not signed in",
	rate_limited: "Rate limited",
	context_too_large: "The project is too large for this model",
	invalid_output: "The model didn't return usable files",
	aborted: "Stopped",
	network: "Can't reach the provider",
	unknown: "Generation failed",
};

/** What went wrong, and the one action most likely to fix it. */
function FailureCard({
	failure,
	onRetry,
	onDismiss,
}: {
	failure: GenerationFailure;
	onRetry: () => void;
	onDismiss: () => void;
}) {
	const { settings } = useProviders();
	const type = settings.providers.find((p) => p.id === failure.providerId)?.type;
	const providerType = PROVIDER_TYPES.find((t) => t.type === type);
	const settingsFix = failure.code === "not_authenticated" || failure.code === "not_installed";
	return (
		<div role="alert" className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/6 p-3 text-[13px]">
			<div className="flex items-start gap-2">
				<AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
				<div className="min-w-0 flex-1">
					<p className="font-medium">{FAILURE_TITLE[failure.code]}</p>
					<p className="mt-0.5 break-words text-muted-foreground">{failure.message}</p>
					{failure.fix ? <p className="mt-1.5">{failure.fix}</p> : null}
				</div>
				<Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss} className="-mt-0.5 -mr-1">
					<X />
				</Button>
			</div>
			<div className="flex flex-wrap gap-1.5 pl-6">
				{failure.retryable ? (
					<Button size="xs" onClick={onRetry}>
						Try again
					</Button>
				) : null}
				{settingsFix || !failure.retryable ? (
					<Button size="xs" variant={failure.retryable ? "outline" : "default"} onClick={() => openSettings(failure.providerId ?? null)}>
						Open settings
					</Button>
				) : null}
				{failure.code === "not_installed" && providerType?.helpUrl ? (
					<Button size="xs" variant="outline" onClick={() => void api.openExternal({ url: providerType.helpUrl! })}>
						Install {providerType.label}
					</Button>
				) : null}
			</div>
		</div>
	);
}
