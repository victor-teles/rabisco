import { useCallback, useRef, useState } from "react";
import {
	INTERVIEW_QUESTIONS,
	answerQuestion,
	currentQuestion,
	hasAnswers,
	interviewPrompt,
	isInterviewDone,
	productFromAnswers,
	questionText,
	skipQuestion,
	startInterview,
	type InterviewState,
} from "@/lib/interview";
import type { Snapshot } from "@/lib/history";
import type { ChatMessage, ContextFileName } from "../../shared/types";
import { useProviders } from "./use-providers";
import type { ChangeOptions } from "./use-project";

export type Interview = {
	/** 1-based number of the question being asked */
	step: number;
	total: number;
};

const message = (role: ChatMessage["role"], content: string): ChatMessage => ({
	id: crypto.randomUUID(),
	role,
	content,
	createdAt: new Date().toISOString(),
});

/**
 * "Write my PRODUCT.md": asks the interview questions as chat messages, takes
 * the answers from the composer and then writes PRODUCT.md with a `context`
 * generation, or straight from the answers when no model is configured.
 * Questions and answers are regular, persisted chat messages; only the
 * position in the interview lives here.
 */
export function useInterview({
	projectName,
	addMessages,
	change,
	writeContext,
	onWritten,
}: {
	projectName: string;
	addMessages: (messages: ChatMessage[]) => void;
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	writeContext: (path: ContextFileName, prompt: string, note?: string) => Promise<boolean>;
	/** PRODUCT.md was written */
	onWritten: () => void;
}) {
	const { model } = useProviders();
	const [state, setState] = useState<InterviewState | null>(null);
	// Answers can arrive faster than a render; read the latest state from here
	const live = useRef<InterviewState | null>(null);

	const update = (next: InterviewState | null) => {
		live.current = next;
		setState(next);
	};

	const finish = useCallback(
		async (done: InterviewState) => {
			update(null);

			if (!hasAnswers(done)) {
				addMessages([message("assistant", "No answers, so I left PRODUCT.md as it was.")]);

				return;
			}

			if (model) {
				if (await writeContext("PRODUCT.md", interviewPrompt(done))) onWritten();

				return;
			}

			// No model: the answers already are a PRODUCT.md
			const content = productFromAnswers(done, projectName);
			change((snapshot) => ({ ...snapshot, files: { ...snapshot.files, "PRODUCT.md": content } }));
			addMessages([
				{
					...message(
						"assistant",
						"Wrote PRODUCT.md from your answers. Set up a model to have them written up properly.",
					),
					context: [],
				},
			]);
			onWritten();
		},
		[model, projectName, addMessages, change, writeContext, onWritten],
	);

	/** Moves past the current question with `next` and asks the following one, or finishes. */
	const advance = useCallback(
		(next: InterviewState, answer?: string) => {
			const following = currentQuestion(next);

			const messages = [
				answer === undefined ? null : message("user", answer),
				following ? message("assistant", questionText(following)) : null,
			];

			addMessages(messages.filter((m): m is ChatMessage => m !== null));

			if (isInterviewDone(next)) void finish(next);
			else update(next);
		},
		[addMessages, finish],
	);

	const start = useCallback(() => {
		if (live.current) return;
		const first = startInterview();
		addMessages([
			message(
				"assistant",
				`Let's write your PRODUCT.md. ${INTERVIEW_QUESTIONS.length} short questions; skip any you like.\n\n${questionText(currentQuestion(first)!)}`,
			),
		]);
		update(first);
	}, [addMessages]);

	const answer = useCallback(
		(text: string) => {
			const current = live.current;

			if (current && text.trim()) advance(answerQuestion(current, text), text.trim());
		},
		[advance],
	);

	const skip = useCallback(() => {
		const current = live.current;

		if (current) advance(skipQuestion(current));
	}, [advance]);

	const cancel = useCallback(() => {
		if (!live.current) return;
		update(null);
		addMessages([message("assistant", "Interview cancelled. PRODUCT.md is unchanged.")]);
	}, [addMessages]);

	const interview: Interview | null = state ? { step: state.step + 1, total: INTERVIEW_QUESTIONS.length } : null;

	return { interview, start, answer, skip, cancel };
}
