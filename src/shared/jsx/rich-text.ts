// Rich text is text with `<strong>`, `<em>` and `<a href>` inside one element, edited inline on the canvas

import { attrValue } from "./text";
import type { JsxElement } from "./tree";

export type RichRun = { text: string; bold?: boolean; italic?: boolean; href?: string };

type Marks = { bold: boolean; italic: boolean; href: string | null };

const BOLD_TAGS = new Set(["strong", "b"]);

const ITALIC_TAGS = new Set(["em", "i"]);

const PLAIN: Marks = { bold: false, italic: false, href: null };

/** `"…"`, `'…'` or a plain template: the string a child expression renders */
function stringLiteral(code: string): string | null {
	const text = code.trim();

	if (/^"(?:[^"\\\n]|\\.)*"$/.test(text)) return JSON.parse(text);

	return (/^'([^'\\\n]*)'$/.exec(text) ?? /^`([^`\\$]*)`$/.exec(text))?.[1] ?? null;
}

const runOf = (text: string, marks: Marks): RichRun => {
	const run: RichRun = { text };

	if (marks.bold) run.bold = true;

	if (marks.italic) run.italic = true;

	if (marks.href !== null) run.href = marks.href;

	return run;
};

/** The marks a formatting tag adds, or `null` for any other element or attribute */
function marksOf(element: JsxElement, marks: Marks): Marks | null {
	const name = element.name;

	if (!element.intrinsic || name === null) return null;
	const link = name === "a";

	if (!link && !BOLD_TAGS.has(name) && !ITALIC_TAGS.has(name)) return null;
	let href: string | null = null;

	for (const attribute of element.attributes) {
		if (!link || attribute.kind !== "attribute" || attribute.name !== "href" || attribute.value?.kind !== "string")
			return null;
		href = attribute.value.value;
	}

	if (link && href === null) return null;

	return {
		bold: marks.bold || BOLD_TAGS.has(name),
		italic: marks.italic || ITALIC_TAGS.has(name),
		href: link ? href : marks.href,
	};
}

/** `null` when a child is anything but text and formatting tags; runs keep the text as React renders it */
export function readRichText(element: JsxElement): RichRun[] | null {
	const runs: RichRun[] = [];

	const walk = (parent: JsxElement, marks: Marks): boolean =>
		parent.children.every((child) => {
			if (child.kind === "text") {
				if (child.value) runs.push(runOf(child.value, marks));

				return true;
			}

			if (child.kind === "expression") {
				if (child.empty) return true;
				const text = stringLiteral(child.text);

				if (text !== null && text) runs.push(runOf(text, marks));

				return text !== null;
			}

			const inner = marksOf(child, marks);

			return inner !== null && walk(child, inner);
		});

	return walk(element, PLAIN) ? mergeRuns(runs) : null;
}

const sameMarks = (a: RichRun, b: RichRun) =>
	Boolean(a.bold) === Boolean(b.bold) && Boolean(a.italic) === Boolean(b.italic) && a.href === b.href;

/** Neighbours with the same marks become one run; empty runs go */
export function mergeRuns(runs: readonly RichRun[]): RichRun[] {
	const merged: RichRun[] = [];

	for (const run of runs) {
		if (!run.text) continue;
		const last = merged[merged.length - 1];

		if (last && sameMarks(last, run)) last.text += run.text;
		else merged.push({ ...run });
	}

	return merged;
}

export const richPlainText = (runs: readonly RichRun[]) => runs.map((run) => run.text).join("");

export const hasMarks = (runs: readonly RichRun[]) =>
	runs.some((run) => run.bold || run.italic || run.href !== undefined);

/** Inline JSX text keeps its spaces; braces, tags and entities go in a string */
const textCode = (text: string) => (/[{}<>&]/.test(text) ? `{${JSON.stringify(text)}}` : text);

/** Consecutive runs that share `key` */
function groupBy<T>(runs: RichRun[], key: (run: RichRun) => T): { key: T; runs: RichRun[] }[] {
	const groups: { key: T; runs: RichRun[] }[] = [];

	for (const run of runs) {
		const value = key(run);
		const last = groups[groups.length - 1];

		if (last && last.key === value) last.runs.push(run);
		else groups.push({ key: value, runs: [run] });
	}

	return groups;
}

/** One line of JSX children: links hold bold, bold holds italic */
export function richChildren(runs: readonly RichRun[]): string {
	const italic = (group: RichRun[]) =>
		groupBy(group, (run) => Boolean(run.italic))
			.map(({ key, runs: inner }) => {
				const text = inner.map((run) => textCode(run.text)).join("");

				return key ? `<em>${text}</em>` : text;
			})
			.join("");

	const bold = (group: RichRun[]) =>
		groupBy(group, (run) => Boolean(run.bold))
			.map(({ key, runs: inner }) => (key ? `<strong>${italic(inner)}</strong>` : italic(inner)))
			.join("");

	return groupBy(mergeRuns(runs), (run) => run.href)
		.map(({ key, runs: inner }) => (key === undefined ? bold(inner) : `<a href=${attrValue(key)}>${bold(inner)}</a>`))
		.join("");
}
