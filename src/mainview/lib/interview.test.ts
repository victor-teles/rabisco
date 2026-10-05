import { describe, expect, test } from "bun:test";
import {
	INTERVIEW_QUESTIONS,
	answerQuestion,
	currentQuestion,
	hasAnswers,
	interviewPrompt,
	isInterviewDone,
	productFromAnswers,
	skipQuestion,
	startInterview,
} from "./interview";

const finish = (...answers: string[]) => answers.reduce(answerQuestion, startInterview());

describe("interview", () => {
	test("asks the questions in order and ends after the last one", () => {
		let state = startInterview();

		for (const question of INTERVIEW_QUESTIONS) {
			expect(isInterviewDone(state)).toBe(false);
			expect(currentQuestion(state)).toBe(question);
			state = answerQuestion(state, "  yes  ");
		}

		expect(isInterviewDone(state)).toBe(true);
		expect(currentQuestion(state)).toBeNull();
		expect(state.answers).toEqual(["yes", "yes", "yes", "yes"]);
		// Answers after the end are ignored
		expect(answerQuestion(state, "more")).toBe(state);
	});

	test("skipping records an empty answer", () => {
		const state = skipQuestion(answerQuestion(startInterview(), "A habit tracker"));
		expect(state).toEqual({ step: 2, answers: ["A habit tracker", ""] });
		expect(hasAnswers(state)).toBe(true);
		expect(hasAnswers(skipQuestion(startInterview()))).toBe(false);
	});

	test("the prompt contains every answered question and leaves skipped ones out", () => {
		const prompt = interviewPrompt(finish("A habit tracker", "", "Calm and direct", "iOS first"));
		expect(prompt).toContain("PRODUCT.md");
		// Questions are lines ending in "?", answers follow on the next line; nothing else reads as an answer
		const lines = prompt.split("\n").filter(Boolean);
		expect(lines.filter((line) => !line.startsWith("A: ")).every((line) => line.endsWith("?"))).toBe(true);
		expect(prompt).toContain(`Q: ${INTERVIEW_QUESTIONS[0]!.question}\nA: A habit tracker`);
		expect(prompt).toContain("A: Calm and direct");
		expect(prompt).toContain("A: iOS first");
		expect(prompt).not.toContain(INTERVIEW_QUESTIONS[1]!.question);
	});

	test("assembles PRODUCT.md from the answers without a model", () => {
		const markdown = productFromAnswers(finish("A habit tracker", "People who forget", "", "Offline"), "Habits");
		expect(markdown).toBe(
			"# Habits\n\n## Product\n\nA habit tracker\n\n## Audience\n\nPeople who forget\n\n## Constraints\n\nOffline\n",
		);
		expect(productFromAnswers(finish("x"), "  ")).toStartWith("# Product\n");
	});
});
