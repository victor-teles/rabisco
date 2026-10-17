import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export type PromptRequest = {
	title: string;
	description: string;
	placeholder: string;
	submit: string;
	optional?: boolean;
	run: (text: string) => void;
};

let pending: PromptRequest | null = null;

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
	listeners.add(listener);

	return () => void listeners.delete(listener);
};

function setPending(next: PromptRequest | null) {
	pending = next;

	for (const listener of listeners) listener();
}

export function askPrompt(request: PromptRequest) {
	setPending(request);
}

export function PromptDialog() {
	const request = useSyncExternalStore(subscribe, () => pending);

	return (
		<Dialog open={request !== null} onOpenChange={(open) => !open && setPending(null)}>
			<DialogContent className="sm:max-w-md">{request ? <PromptForm request={request} /> : null}</DialogContent>
		</Dialog>
	);
}

function PromptForm({ request }: { request: PromptRequest }) {
	const [text, setText] = useState("");
	const ready = request.optional || text.trim().length > 0;

	const submit = (event?: React.FormEvent) => {
		event?.preventDefault();

		if (!ready) return;
		setPending(null);
		request.run(text.trim());
	};

	return (
		<form onSubmit={submit} className="grid gap-4">
			<DialogHeader>
				<DialogTitle>{request.title}</DialogTitle>
				<DialogDescription>{request.description}</DialogDescription>
			</DialogHeader>
			<Textarea
				autoFocus
				rows={3}
				value={text}
				placeholder={request.placeholder}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
						event.preventDefault();
						submit();
					}
				}}
			/>
			<DialogFooter>
				<Button type="button" variant="ghost" onClick={() => setPending(null)}>
					Cancel
				</Button>
				<Button type="submit" disabled={!ready}>
					{request.submit}
				</Button>
			</DialogFooter>
		</form>
	);
}
