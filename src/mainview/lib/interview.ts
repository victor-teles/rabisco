/**
 * The "Write my PRODUCT.md" interview: four short questions asked in the chat,
 * one at a time. Pure state; `use-interview` turns it into chat messages and
 * a `context` generation.
 */

export type InterviewQuestion = {
	/** Section of PRODUCT.md the answer goes to */
	section: "Product" | "Audience" | "Voice" | "Constraints";
	/** One sentence ending in "?": the prompt marks questions that way */
	question: string;
	/** Shown after the question in the chat, not sent to the model */
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
	/** Index of the question being asked; `INTERVIEW_QUESTIONS.length` once done */
	step: number;
	/** One per asked question; `""` for skipped ones */
	answers: string[];
};

export const startInterview = (): InterviewState => ({ step: 0, answers: [] });

export const isInterviewDone = (state: InterviewState) => state.step >= INTERVIEW_QUESTIONS.length;

/** The question as the chat asks it */
export const questionText = (q: InterviewQuestion) => (q.hint ? `${q.question} ${q.hint}` : q.question);

export const currentQuestion = (state: InterviewState): InterviewQuestion | null =>
	INTERVIEW_QUESTIONS[state.step] ?? null;

/** Records the answer to the current question and moves to the next one. */
export function answerQuestion(state: InterviewState, answer: string): InterviewState {
	if (isInterviewDone(state)) return state;

	return { step: state.step + 1, answers: [...state.answers, answer.trim()] };
}

export const skipQuestion = (state: InterviewState) => answerQuestion(state, "");

/** At least one question got a real answer, so there is something to write. */
export const hasAnswers = (state: InterviewState) => state.answers.some(Boolean);

const answered = (state: InterviewState) =>
	INTERVIEW_QUESTIONS.flatMap((q, i) => {
		const answer = state.answers[i];

		return answer ? [{ ...q, answer }] : [];
	});

/**
 * The prompt of the `context` generation that writes PRODUCT.md: Q&A blocks, each
 * question on its own line ending in "?" and the answer on the lines after it.
 * The instruction is phrased as a question too, so no line of it reads as an answer.
 */
export function interviewPrompt(state: InterviewState): string {
	const qa = answered(state).map((q) => `Q: ${q.question}\nA: ${q.answer}`);

	return [
		"Can you write PRODUCT.md from my interview answers below, keeping my wording and leaving out what I skipped?",
		...qa,
	].join("\n\n");
}

/** PRODUCT.md assembled directly from the answers, for when no model is configured. `title` is the project name. */
export function productFromAnswers(state: InterviewState, title: string): string {
	const sections = answered(state).map((q) => `## ${q.section}\n\n${q.answer}`);

	return `# ${title.trim() || "Product"}\n\n${sections.join("\n\n")}\n`;
}
