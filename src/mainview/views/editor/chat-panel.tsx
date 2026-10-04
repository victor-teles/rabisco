import { useEffect, useRef } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { DesignComposer, DeviceToggle, MODELS } from "@/components/app/design-composer";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { ChatMessage, Device } from "../../../shared/types";

export type Generation = {
	id: string;
	steps: string[];
};

type ChatPanelProps = {
	messages: ChatMessage[];
	generation: Generation | null;
	device: Device;
	onDeviceChange: (device: Device) => void;
	model: string;
	onModelChange: (model: string) => void;
	onSend: (prompt: string) => void;
	selectedScreenName?: string;
};

export function ChatPanel({
	messages,
	generation,
	device,
	onDeviceChange,
	model,
	onModelChange,
	onSend,
	selectedScreenName,
}: ChatPanelProps) {
	const endRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
	}, [messages.length, generation?.steps.length]);

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
						</div>
					) : null}

					{messages.map((message) => (
						<Message key={message.id} from={message.role} variant="bubble">
							{message.role === "assistant" ? <MessageAvatar /> : null}
							<MessageBody>
								<MessageContent className="whitespace-pre-wrap">{message.content}</MessageContent>
							</MessageBody>
						</Message>
					))}

					{generation ? (
						<Thinking status="thinking">
							<ThinkingTrigger
								title="Designing"
								summary={generation.steps.at(-1) ?? "Starting…"}
							/>
							<ThinkingContent>
								{generation.steps.map((step) => (
									<ThinkingActivity key={step} type="progress">
										{step}
									</ThinkingActivity>
								))}
							</ThinkingContent>
						</Thinking>
					) : null}
					<div ref={endRef} />
				</div>
			</ScrollArea>

			<div className="p-3 pt-0">
				<DesignComposer
					busy={generation !== null}
					device={device}
					onDeviceChange={onDeviceChange}
					model={model}
					onModelChange={onModelChange}
					onSubmit={onSend}
					inlineOptions={false}
					placeholder={selectedScreenName ? `Change ${selectedScreenName}…` : "Describe screens to add…"}
				/>
				<div className="mt-1.5 flex items-center gap-1 px-0.5">
					<DeviceToggle device={device} onDeviceChange={onDeviceChange} />
					<ModelMenu model={model} onModelChange={onModelChange} />
					{selectedScreenName ? (
						<span className="ml-auto truncate text-xs text-subtle-foreground">
							Editing <span className="font-medium text-muted-foreground">{selectedScreenName}</span>
						</span>
					) : null}
				</div>
			</div>
		</aside>
	);
}

function ModelMenu({ model, onModelChange }: { model: string; onModelChange: (model: string) => void }) {
	const selected = MODELS.find((m) => m.id === model) ?? MODELS[0];
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="xs" className="h-7 gap-1 text-muted-foreground">
					{selected.label}
					<ChevronDown className="size-3" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" side="top">
				<DropdownMenuRadioGroup value={selected.id} onValueChange={onModelChange}>
					{MODELS.map((m) => (
						<DropdownMenuRadioItem key={m.id} value={m.id} className="text-[13px]">
							{m.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
