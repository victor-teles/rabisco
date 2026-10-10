import type { Attachment, Problem } from "../ai/contract";
import type { DesignNote } from "../change-summary";
import { hashString } from "../jsx/hash";
import { screenNameFromPath } from "../project";
import type { FileChange, ProjectFiles, VisualReview } from "../types";
import { DESIGN_RULE_LABELS, type DesignFinding } from "./findings";

export type ScreenFindings = { screen: string; findings: DesignFinding[]; image?: string };

export const POLISHED_TASKS: ReadonlySet<string> = new Set(["create", "edit", "vary"]);

export const MAX_POLISH_PROBLEMS = 8;

export const MAX_DESIGN_NOTES = 20;

export const CHECKING_STEP = "Checking the design";

export const polishLabel = (count: number) => `Polishing ${count} ${count === 1 ? "problem" : "problems"}`;

export const POLISH_PROMPT = [
	"These are visual problems the design check found after the screens rendered. They are not code errors.",
	"Keep the design, the content and the layout. Fix each problem with the smallest change.",
	"For low contrast, use a theme color pair that reads well. For clipped text, let it wrap or grow, or truncate it on purpose.",
	"For content wider than the screen, let it wrap or shrink, or scroll inside its own container.",
].join(" ");

const problemOf = (screen: string, finding: DesignFinding): Problem => ({
	path: finding.path ?? screen,
	message: `${DESIGN_RULE_LABELS[finding.rule]}: ${finding.message}`,
	line: finding.line,
});

export function polishProblems(checks: ScreenFindings[]): Problem[] {
	const seen = new Set<string>();
	const problems: Problem[] = [];

	for (const { screen, findings } of checks) {
		for (const finding of findings) {
			if (finding.severity !== "error") continue;
			const problem = problemOf(screen, finding);
			const key = `${problem.path}:${problem.line ?? ""}:${finding.rule}`;

			if (seen.has(key)) continue;
			seen.add(key);
			problems.push(problem);
		}
	}

	return problems.slice(0, MAX_POLISH_PROBLEMS);
}

export type PolishRequest = { prompt: string; targets: string[]; problems: Problem[]; review?: VisualReview };

export function polishRequest(problems: Problem[]): PolishRequest {
	return { prompt: POLISH_PROMPT, targets: [...new Set(problems.map((problem) => problem.path))], problems };
}

export type PolishMode = "off" | "polish" | "review";

export const polishModeOf = (polish: boolean, review: boolean): PolishMode =>
	polish ? (review ? "review" : "polish") : "off";

export const REVIEW_STEP = "Reviewing screenshots";

export const APPLYING_REVIEW_STEP = "Applying review";

const REVIEW_MAX_WIDTH = 1280;

const REVIEW_MAX_SCREENS = 6;

const BRIEF_LENGTH = 1200;

export type ReviewRaster = { type: "image/jpeg"; scale: number; quality: number; maxHeight: number };

export const reviewRaster = (width: number, height: number): ReviewRaster => ({
	type: "image/jpeg",
	scale: Math.min(1, REVIEW_MAX_WIDTH / Math.max(1, width)),
	quality: 0.8,
	maxHeight: height * 2,
});

const MEDIA_TYPES: Attachment["mediaType"][] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function screenshotOf(screen: string, dataUrl: string): Attachment | null {
	const match = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl);
	const mediaType = MEDIA_TYPES.find((type) => type === match?.[1]);

	if (!match || !mediaType) return null;

	return { name: `${screen}.${mediaType === "image/jpeg" ? "jpg" : mediaType.slice(6)}`, mediaType, data: match[2]! };
}

const lineOf = (problem: Problem) => `- ${problem.path}${problem.line ? `:${problem.line}` : ""}: ${problem.message}`;

export function reviewPrompt(brief: string, shots: Attachment[], problems: Problem[], notes: Problem[]): string {
	const ask = brief.trim();
	const cut = ask.length > BRIEF_LENGTH ? `${ask.slice(0, BRIEF_LENGTH).trimEnd()}…` : ask;

	const parts = [
		`The attached images are screenshots of the screens as they render now, one per screen, named after its file: ${shots.map((shot) => shot.name).join(", ")}.`,
		"Look at each one next to the request and DESIGN.md, and fix only clear visual problems: misaligned elements, cramped or uneven spacing, a broken hierarchy, content that overflows or is cut off, text that is hard to read, and anything that doesn't follow DESIGN.md.",
		"Keep the design, the layout, the content and the copy. Make the smallest change that fixes each problem. Leave a file that looks right as it is; if nothing needs fixing, write no files.",
		'Reply with one short line that says what you changed, like "Tightened the spacing in Home.", or "Nothing to fix."',
	];

	if (problems.length) parts.unshift(POLISH_PROMPT, "Fix the listed problems first.");

	if (notes.length)
		parts.push(
			`The design check also noted these; fix one only if its screenshot shows the problem:\n${notes.map(lineOf).join("\n")}`,
		);

	if (cut) parts.push(`The screens were made for this request:\n${cut}`);

	return parts.join("\n\n");
}

export function reviewRequest(brief: string, checks: ScreenFindings[]): PolishRequest {
	const problems = polishProblems(checks);

	const shown = checks.slice(0, REVIEW_MAX_SCREENS).flatMap(({ screen, image }) => {
		const shot = image ? screenshotOf(screen, image) : null;

		return shot ? [{ screen, shot }] : [];
	});

	if (!shown.length) return polishRequest(problems);
	const shots = shown.map(({ shot }) => shot);

	const notes: Problem[] = [];

	for (const { screen, findings } of checks) {
		for (const finding of findings) {
			if (finding.severity === "warning" && notes.length < MAX_POLISH_PROBLEMS) notes.push(problemOf(screen, finding));
		}
	}

	return {
		prompt: POLISH_PROMPT,
		targets: [...new Set([...shown.map(({ screen }) => screen), ...problems.map((problem) => problem.path)])],
		problems,
		review: { prompt: reviewPrompt(brief, shots, problems, notes), attachments: shots },
	};
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function reviewNote(reply: string, writes: FileChange[]): string {
	const changed = writes.map((write) => screenNameFromPath(write.path));

	const line = reply
		.split("\n")
		.map((text) => text.trim())
		.find(Boolean);

	if (!changed.length) return "Review: nothing to fix.";

	const said = line && !/^nothing to fix/i.test(line) ? lowerFirst(line) : `changed ${changed.join(", ")}`;

	return `Review: ${/[.!?]$/.test(said) ? said : `${said}.`}`;
}

export function noteProblem(note: DesignNote, fresh: boolean): Problem {
	return {
		path: note.path,
		message: `${DESIGN_RULE_LABELS[note.rule]}: ${note.message}`,
		line: fresh ? note.line : undefined,
	};
}

export const isFreshNote = (note: DesignNote, files: ProjectFiles) => {
	const source = files[note.path];

	return source !== undefined && (note.version === undefined || note.version === hashString(source));
};

export function noteSelection(note: DesignNote, files: ProjectFiles) {
	if (files[note.screen] === undefined) return null;
	const own = note.path === note.screen && note.start !== undefined && isFreshNote(note, files);

	return { screen: note.screen, element: own ? { file: note.screen, start: note.start ?? 0 } : null };
}

export function designNotesOf(checks: ScreenFindings[], files: ProjectFiles): DesignNote[] {
	const seen = new Set<string>();
	const notes: DesignNote[] = [];

	for (const { screen, findings } of checks) {
		for (const finding of findings) {
			const path = finding.path ?? screen;
			const key = `${path}:${finding.start ?? ""}:${finding.rule}:${finding.message}`;

			if (seen.has(key)) continue;
			seen.add(key);
			const source = files[path];
			const note: DesignNote = { ...finding, screen, path };

			if (source !== undefined) note.version = hashString(source);
			notes.push(note);
		}
	}

	const order = { error: 0, warning: 1 } as const;

	return notes
		.sort(
			(a, b) => order[a.severity] - order[b.severity] || a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0),
		)
		.slice(0, MAX_DESIGN_NOTES);
}

export const polishWrites = (changes: FileChange[], files: ProjectFiles, targets: string[]) =>
	changes.filter(
		(change) =>
			change.content !== null &&
			targets.includes(change.path) &&
			change.path in files &&
			files[change.path] !== change.content,
	);

export function mergeChanges(first: FileChange[], then: FileChange[]): FileChange[] {
	const merged = new Map<string, string | null>();

	for (const { path, content } of [...first, ...then]) merged.set(path, content);

	return [...merged].map(([path, content]) => ({ path, content }));
}

export function notesByFile(notes: DesignNote[]): { path: string; notes: DesignNote[] }[] {
	const groups = new Map<string, DesignNote[]>();

	for (const note of notes) {
		const group = groups.get(note.path);

		if (group) group.push(note);
		else groups.set(note.path, [note]);
	}

	return [...groups].map(([path, grouped]) => ({ path, notes: grouped }));
}
