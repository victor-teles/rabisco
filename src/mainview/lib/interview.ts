export type InterviewQuestion = {
	section: "Product" | "Audience" | "Voice" | "Constraints";
	/** Must end in "?": the prompt marks questions that way. */
	question: string;
	/** Shown in the chat, not sent to the model. */
	hint: string;
};

export const INTERVIEW_QUESTIONS: readonly InterviewQuestion[] = [
	{ section: "Product", question: "What are you building?", hint: "A sentence or two is enough." },
	{ section: "Audience", question: "Who is it for, and what do they need from it?", hint: "" },
	{
		section: "Voice",
		question: "How should it sound?",
		hint: "A few words on the voice and tone, e.g. calm, direct, playful.",
	},
	{
		section: "Constraints",
		question: "Any constraints or must-haves?",
		hint: "Platforms, accessibility, things to avoid.",
	},
];

export type InterviewState = {
	/** `INTERVIEW_QUESTIONS.length` once done. */
	step: number;
	/** `""` for skipped questions. */
	answers: string[];
};

export const startInterview = (): InterviewState => ({ step: 0, answers: [] });

export const isInterviewDone = (state: InterviewState) => state.step >= INTERVIEW_QUESTIONS.length;

export const questionText = (q: InterviewQuestion) => (q.hint ? `${q.question} ${q.hint}` : q.question);

export const currentQuestion = (state: InterviewState): InterviewQuestion | null =>
	INTERVIEW_QUESTIONS[state.step] ?? null;

export function answerQuestion(state: InterviewState, answer: string): InterviewState {
	if (isInterviewDone(state)) return state;

	return { step: state.step + 1, answers: [...state.answers, answer.trim()] };
}

export const skipQuestion = (state: InterviewState) => answerQuestion(state, "");

export const hasAnswers = (state: InterviewState) => state.answers.some(Boolean);

const answered = (state: InterviewState) =>
	INTERVIEW_QUESTIONS.flatMap((q, i) => {
		const answer = state.answers[i];

		return answer ? [{ ...q, answer }] : [];
	});

/** The instruction is phrased as a question too, so no line of it reads as an answer. */
export function interviewPrompt(state: InterviewState): string {
	const qa = answered(state).map((q) => `Q: ${q.question}\nA: ${q.answer}`);

	return [
		"Can you write PRODUCT.md from my interview answers below, keeping my wording and leaving out what I skipped?",
		...qa,
	].join("\n\n");
}

/** Fallback when no model is configured. */
export function productFromAnswers(state: InterviewState, title: string): string {
	const sections = answered(state).map((q) => `## ${q.section}\n\n${q.answer}`);

	return `# ${title.trim() || "Product"}\n\n${sections.join("\n\n")}\n`;
}
