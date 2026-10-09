import { Fragment, memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Crosshair, MessageSquareText, Pencil, RotateCcw, RotateCw, Sparkles, X } from "lucide-react";
import { DesignComposer, DeviceToggle, ModelPicker, VariationsPicker } from "@/components/app/design-composer";
import { Markdown } from "@/components/app/markdown";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Attachment as AttachmentCard,
	AttachmentDetails,
	AttachmentName,
	AttachmentThumbnail,
} from "@/components/ui/uai/attachment";
import {
	Citation,
	CitationExcerpt,
	CitationPopover,
	CitationTitle,
	CitationTrigger,
} from "@/components/ui/uai/citation";
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
import {
	Message,
	MessageAction,
	MessageActions,
	MessageAvatar,
	MessageBody,
	MessageContent,
	MessageCopy,
} from "@/components/ui/uai/message";
import {
	ResponseStatus,
	ResponseStatusActions,
	ResponseStatusDetail,
	ResponseStatusIndicator,
	ResponseStatusLabel,
	ResponseStatusRetry,
} from "@/components/ui/uai/response-status";
import { Thinking, ThinkingActivity, ThinkingContent, ThinkingTrigger } from "@/components/ui/uai/thinking";
import {
	ToolCall,
	ToolCallContent,
	ToolCallHeader,
	ToolCallName,
	ToolCallOutput,
	ToolCallStatus,
	ToolCallSummary,
	ToolCallTrigger,
} from "@/components/ui/uai/tool-call";
import { openSettings, useProviders } from "@/hooks/use-providers";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import type { Generation, WritingFile } from "@/hooks/use-generation";
import type { Interview } from "@/hooks/use-interview";
import { type ChatCommand, parseCommand } from "@/lib/chat-commands";
import { api } from "@/lib/rpc";
import type { Attachment } from "../../../shared/ai/contract";
import { PROVIDER_TYPES } from "../../../shared/ai/settings";
import type { ChatMessage, ContextFileName, Device, GenerationFailure } from "../../../shared/types";
import { ChangeSummaryCard } from "./change-summary";

/** One file the generation writes, as it streams; open it to read the code so far */
function WrittenFile({ path, file }: { path: string; file: WritingFile }) {
	const [open, setOpen] = useState(false);
	const lines = file.text ? file.text.split("\n").length : 0;

	return (
		<ToolCall variant="compact" status={file.done ? "success" : "running"} open={open} onOpenChange={setOpen}>
			<ToolCallHeader>
				<ToolCallTrigger>
					<ToolCallName>{file.done ? "Wrote" : "Writing"}</ToolCallName>
					<ToolCallSummary className="font-mono text-[11.5px]" title={path}>
						{path}
					</ToolCallSummary>
				</ToolCallTrigger>
				<ToolCallStatus>{lines === 1 ? "1 line" : `${lines} lines`}</ToolCallStatus>
			</ToolCallHeader>
			{/* Only while open: the code changes with every streamed chunk */}
			{open ? (
				<ToolCallContent>
					<ToolCallOutput label="Code">{file.text}</ToolCallOutput>
				</ToolCallContent>
			) : null}
		</ToolCall>
	);
}

/** A prompt that couldn't be sent yet, shown in the composer */
export type HeldPrompt = { prompt: string; files?: File[] };

/** Text added to the end of the composer, for review before it is sent; a new `key` adds it again */
export type ComposerInsert = { key: number; text: string };

type ChatPanelProps = {
	messages: ChatMessage[];
	generation: Generation | null;
	/** Takes back the generation of reply `id`; `null` once that is no longer the latest undo step */
	undoableRun?: { id: string; run: () => void } | null;
	failure: GenerationFailure | null;
	device: Device;
	onDeviceChange: (device: Device) => void;
	/** `false`: nothing was sent, so the prompt stays in the composer */
	onSend: (prompt: string, files: File[]) => boolean;
	/** Sent on its own once a model is set up */
	heldPrompt?: HeldPrompt | null;
	onHeldPromptSent?: () => void;
	onStop: () => void;
	onRetry: () => void;
	/** Runs the last request again; `null` when there is none */
	onRegenerate?: (() => void) | null;
	onDismissFailure: () => void;
	selectedScreenName?: string;
	/** With any, the variations count doesn't apply */
	editingCount: number;
	focusLabel?: string;
	onClearFocus?: () => void;
	/** Bumped to put the caret in the composer */
	composeKey?: number;
	insert?: ComposerInsert | null;
	variations: number;
	onVariationsChange: (variations: number) => void;
	onOpenContext: (file: ContextFileName) => void;
	/** While it runs, the composer sends answers */
	interview: Interview | null;
	onStartInterview: () => void;
	onSkipQuestion: () => void;
	onCancelInterview: () => void;
	/** Typing `/` lists them; a known `/name args` runs instead of being sent as a prompt */
	commands: readonly ChatCommand[];
	/** `false` when it didn't run */
	onRunCommand: (command: ChatCommand, args: string, files?: File[]) => boolean;
};

const TASK_TITLE = {
	create: "Designing",
	edit: "Editing",
	repair: "Fixing",
	context: "Writing",
	vary: "Varying",
	theme: "Reading the theme",
} as const;

function generationTitle(generation: Generation) {
	if (generation.attempt > 1) return "Fixing problems";
	const title = TASK_TITLE[generation.task];

	return generation.variations > 1 ? `${title} · ${generation.variations} variations` : title;
}

export const ChatPanel = memo(function ChatPanel({
	messages,
	generation,
	failure,
	device,
	onDeviceChange,
	onSend,
	heldPrompt,
	onHeldPromptSent,
	onStop,
	onRetry,
	onRegenerate,
	undoableRun = null,
	onDismissFailure,
	selectedScreenName,
	editingCount,
	focusLabel,
	onClearFocus,
	composeKey = 0,
	insert,
	variations,
	onVariationsChange,
	onOpenContext,
	interview,
	onStartInterview,
	onSkipQuestion,
	onCancelInterview,
	commands,
	onRunCommand,
}: ChatPanelProps) {
	const { rootRef: scrollRef, pin } = useStickToBottom<HTMLDivElement>();
	const files = generation ? Object.entries(generation.writing) : [];

	// Streaming output follows on its own; a new message brings the reader back down
	useEffect(pin, [messages.length, pin]);

	// Answers go through the composer, so put the caret there when the interview starts
	const interviewing = interview !== null;
	const composerRef = useRef<HTMLDivElement>(null);

	const composerInput = () =>
		composerRef.current?.querySelector<HTMLTextAreaElement>('[data-slot="prompt-composer-input"]');

	useEffect(() => {
		if (interviewing) composerInput()?.focus();
	}, [interviewing]);

	// A frame later, once a hidden or collapsed panel has shown the chat
	useEffect(() => {
		if (!composeKey) return;
		const frame = requestAnimationFrame(() => composerInput()?.focus());

		return () => cancelAnimationFrame(frame);
	}, [composeKey]);

	// A prompt sent without a model waits in the composer, then goes out once one is set up
	const { model } = useProviders();
	const [missedModel, setMissedModel] = useState(false);
	const waiting = heldPrompt != null || missedModel;
	useEffect(() => {
		if (waiting && model) composerRef.current?.querySelector("form")?.requestSubmit();
	}, [waiting, model]);

	const [text, setText] = useState(heldPrompt?.prompt ?? "");
	const [shownHeld, setShownHeld] = useState(heldPrompt);

	if (heldPrompt !== shownHeld) {
		setShownHeld(heldPrompt);

		if (heldPrompt) setText(heldPrompt.prompt);
	}

	// An earlier prompt being edited fills the composer; sending it is a new turn
	const [draft, setDraft] = useState<(HeldPrompt & { key: number }) | null>(null);

	// A new key remounts the composer even when a draft is already in it
	const edit = useCallback(
		(message: ChatMessage) => {
			setText(message.content);
			setDraft((current) => ({
				key: (current?.key ?? 0) + 1,
				prompt: message.content,
				files: message.attachments?.map(attachmentFile),
			}));
		},
		[setDraft],
	);

	useEffect(() => {
		if (draft) composerInput()?.focus();
	}, [draft]);

	// Added after what is already typed, so a note and several comments go out as one prompt.
	// Once per key: a remount must not add it again.
	const [inserted, setInserted] = useState(insert?.key);

	if (insert && insert.key !== inserted) {
		setInserted(insert.key);
		setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${insert.text}` : insert.text));
	}

	const submit = (prompt: string, files: File[]) => {
		const parsed = interview ? null : parseCommand(prompt, commands);

		if (parsed) {
			const ran = onRunCommand(parsed.command, parsed.args, files);

			if (ran) setDraft(null);

			return ran;
		}

		const sent = onSend(prompt, files);
		setMissedModel(!sent && !model);

		if (sent) {
			onHeldPromptSent?.();
			setDraft(null);
		}

		return sent;
	};

	const filled = heldPrompt ?? draft;
	const lastReply = [...messages].reverse().find((message) => message.role === "assistant")?.id;
	const regenerate = generation || failure ? null : (onRegenerate ?? null);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ScrollArea ref={scrollRef} className="min-h-0 flex-1">
				<div className="flex flex-col gap-5 px-4 py-5">
					{messages.length === 0 && !generation ? (
						<EmptyState variant="plain" className="pt-16">
							<EmptyStateMedia>
								<Sparkles />
							</EmptyStateMedia>
							<EmptyStateContent>
								<EmptyStateHeader>
									<EmptyStateTitle>Start with a description</EmptyStateTitle>
									<EmptyStateDescription>
										Tell Rabisco what you're building and who it's for. You can refine each screen afterwards.
									</EmptyStateDescription>
								</EmptyStateHeader>
								<EmptyStateActions>
									<EmptyStateAction emphasis="secondary" onClick={onStartInterview}>
										<MessageSquareText />
										Or start with PRODUCT.md
									</EmptyStateAction>
								</EmptyStateActions>
							</EmptyStateContent>
						</EmptyState>
					) : null}

					<MessageList
						messages={messages}
						onOpenContext={onOpenContext}
						onEdit={generation ? null : edit}
						regenerate={regenerate ? { id: lastReply, run: regenerate } : null}
						lastReply={lastReply}
						undoableRun={undoableRun}
					/>

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
								</ThinkingContent>
							</Thinking>
							{files.length ? (
								<div className="grid gap-1.5">
									{files.map(([path, file]) => (
										<WrittenFile key={path} path={path} file={file} />
									))}
								</div>
							) : null}
							{generation.reply.trim() ? (
								<Message from="assistant" variant="bubble">
									<MessageAvatar />
									<MessageBody>
										<MessageContent>
											<Markdown source={generation.reply.trim()} />
										</MessageContent>
									</MessageBody>
								</Message>
							) : null}
						</>
					) : null}

					{failure && !generation ? (
						<FailureCard failure={failure} onRetry={onRetry} onDismiss={onDismissFailure} />
					) : null}
				</div>
			</ScrollArea>

			<div ref={composerRef} className="p-3 pt-0">
				{interview ? (
					<InterviewBar
						step={interview.step}
						total={interview.total}
						onSkip={onSkipQuestion}
						onCancel={onCancelInterview}
					/>
				) : draft ? (
					<DraftBar
						onCancel={() => {
							setDraft(null);
							setText("");
						}}
					/>
				) : focusLabel ? (
					<FocusChip label={focusLabel} where={selectedScreenName} onClear={onClearFocus} />
				) : null}
				{waiting && !model ? (
					<p className="mb-1.5 px-1 text-xs text-subtle-foreground" aria-live="polite">
						Set up a model and this prompt will be sent.
					</p>
				) : null}
				<DesignComposer
					// Remount so the held or edited prompt's images fill the composer
					key={heldPrompt ? "held" : draft ? `draft-${draft.key}` : "empty"}
					value={text}
					onValueChange={setText}
					defaultFiles={filled?.files}
					busy={generation !== null}
					onStop={onStop}
					device={device}
					onDeviceChange={onDeviceChange}
					onSubmit={submit}
					inlineOptions={false}
					commands={interview ? undefined : commands}
					onRunCommand={(command) => onRunCommand(command, "")}
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
		</div>
	);
});

function attachmentFile(image: Attachment) {
	const bytes = Uint8Array.from(atob(image.data), (char) => char.charCodeAt(0));

	return new File([bytes], image.name, { type: image.mediaType });
}

function DraftBar({ onCancel }: { onCancel: () => void }) {
	return (
		<div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs text-subtle-foreground" aria-live="polite">
			<Pencil className="size-3.5" strokeWidth={1.8} />
			<span>Editing an earlier prompt</span>
			<button
				type="button"
				onClick={onCancel}
				className="ml-auto rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
			>
				Cancel
			</button>
		</div>
	);
}

function AttachedImages({ images }: { images: Attachment[] }) {
	return (
		<div className="flex flex-wrap justify-end gap-1.5">
			{images.map((image, index) => (
				<AttachmentCard key={index} variant="card" mimeType={image.mediaType} className="w-32">
					<AttachmentThumbnail src={`data:${image.mediaType};base64,${image.data}`} alt={image.name} className="h-20" />
					<AttachmentDetails>
						<AttachmentName title={image.name}>{image.name}</AttachmentName>
					</AttachmentDetails>
				</AttachmentCard>
			))}
		</div>
	);
}

const CONTEXT_PURPOSE: Record<ContextFileName, string> = {
	"PRODUCT.md": "What you're building, who it's for and how it should feel.",
	"DESIGN.md": "The tokens, type and component rules screens follow.",
};

function ContextLine({ files, onOpen }: { files: ContextFileName[]; onOpen: (file: ContextFileName) => void }) {
	return (
		<p className="text-xs text-subtle-foreground">
			Followed{" "}
			{files.map((file) => (
				<Citation key={file} variant="chip">
					<CitationTrigger
						onClick={(event) => {
							// Opening the file is the action; the preview already shows on hover and focus
							event.preventDefault();
							onOpen(file);
						}}
					>
						{file}
					</CitationTrigger>
					{/* Above the line: under the latest reply there is no room below */}
					<CitationPopover className="top-auto bottom-[calc(100%+8px)] w-56 origin-bottom-left">
						<CitationTitle className="pt-2">{file}</CitationTitle>
						<CitationExcerpt>{CONTEXT_PURPOSE[file]} Click to open it.</CitationExcerpt>
					</CitationPopover>
				</Citation>
			))}
		</p>
	);
}

function FocusChip({ label, where, onClear }: { label: string; where?: string; onClear?: () => void }) {
	return (
		<div className="mb-1.5 flex w-fit max-w-full items-center gap-1.5 rounded-md border bg-muted/50 py-0.5 pr-0.5 pl-2 text-xs text-subtle-foreground">
			<Crosshair className="size-3.5 shrink-0" strokeWidth={1.8} />
			<span className="min-w-0 truncate" title={where ? `${label} in ${where}` : label}>
				Editing <span className="font-mono text-[11px] text-foreground">{label}</span>
				{where ? (
					<>
						{" "}
						in <span className="font-medium text-muted-foreground">{where}</span>
					</>
				) : null}
			</span>
			{onClear ? (
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label="Clear the selected element"
					title="Edit the whole screen"
					onClick={onClear}
				>
					<X />
				</Button>
			) : null}
		</div>
	);
}

function InterviewBar({
	step,
	total,
	onSkip,
	onCancel,
}: {
	step: number;
	total: number;
	onSkip: () => void;
	onCancel: () => void;
}) {
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
				Interview ·{" "}
				<span className="tabular-nums">
					{step} of {total}
				</span>
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
	const action = "h-7 rounded-full px-3 text-[12.5px]";

	return (
		<ResponseStatus
			variant="bar"
			status={failure.code === "aborted" ? "stopped" : "failed"}
			className="items-start py-2.5"
		>
			<ResponseStatusIndicator />
			<div className="grid min-w-0 flex-1 gap-0.5">
				<ResponseStatusLabel>{FAILURE_TITLE[failure.code]}</ResponseStatusLabel>
				<ResponseStatusDetail className="[overflow-wrap:anywhere]">{failure.message}</ResponseStatusDetail>
				{failure.fix ? (
					<ResponseStatusDetail className="text-muted-foreground">{failure.fix}</ResponseStatusDetail>
				) : null}
			</div>
			<Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
				<X />
			</Button>
			<ResponseStatusActions className="ml-0 basis-full flex-wrap gap-1.5 pl-7">
				{failure.retryable ? (
					<ResponseStatusRetry onClick={onRetry}>
						<RotateCw className="size-3" aria-hidden="true" />
						Try again
					</ResponseStatusRetry>
				) : null}
				{settingsFix || !failure.retryable ? (
					<Button
						size="sm"
						variant={failure.retryable ? "secondary" : "default"}
						className={action}
						onClick={() => openSettings(failure.providerId ?? null)}
					>
						Open settings
					</Button>
				) : null}
				{failure.code === "not_installed" && providerType?.helpUrl ? (
					<Button
						size="sm"
						variant="secondary"
						className={action}
						onClick={() => void api.openExternal({ url: providerType.helpUrl! })}
					>
						Install {providerType.label}
					</Button>
				) : null}
			</ResponseStatusActions>
		</ResponseStatus>
	);
}

/** Selecting a screen re-renders the composer, not the whole history */
const MessageList = memo(function MessageList({
	messages,
	onOpenContext,
	onEdit,
	regenerate,
	lastReply,
	undoableRun,
}: {
	messages: ChatMessage[];
	onOpenContext: ChatPanelProps["onOpenContext"];
	/** `null` while a generation runs */
	onEdit: ((message: ChatMessage) => void) | null;
	/** Offered on the latest reply only */
	regenerate: { id: string | undefined; run: () => void } | null;
	/** Only the latest reply shows its summary, so the history stays a conversation */
	lastReply: string | undefined;
	undoableRun: { id: string; run: () => void } | null;
}) {
	return messages.map((message) => {
		const assistant = message.role === "assistant";
		const summary = message.id === lastReply ? message.summary : undefined;

		return (
			<Fragment key={message.id}>
				<Message from={message.role} variant="bubble" className="group/message">
					{assistant ? <MessageAvatar /> : null}
					<MessageBody>
						{message.attachments?.length ? <AttachedImages images={message.attachments} /> : null}
						<MessageContent className={assistant ? undefined : "whitespace-pre-wrap"}>
							{assistant ? <Markdown source={message.content} /> : message.content}
						</MessageContent>
						{assistant && message.context?.length ? (
							<ContextLine files={message.context} onOpen={onOpenContext} />
						) : null}
						<MessageActions className="opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
							<MessageCopy text={message.content} />
							{!assistant && onEdit ? (
								<MessageAction label="Edit and resend" onClick={() => onEdit(message)}>
									<Pencil />
								</MessageAction>
							) : null}
							{assistant && regenerate && regenerate.id === message.id ? (
								<MessageAction label="Regenerate" onClick={regenerate.run}>
									<RotateCcw />
								</MessageAction>
							) : null}
						</MessageActions>
					</MessageBody>
				</Message>
				{/* Full width: the file tree needs the room the bubble's indent would take */}
				{summary ? (
					<ChangeSummaryCard summary={summary} onUndo={undoableRun?.id === message.id ? undoableRun.run : undefined} />
				) : null}
			</Fragment>
		);
	});
});
