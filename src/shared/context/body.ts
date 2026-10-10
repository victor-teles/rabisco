/** ATX style, up to 3 spaces of indent */
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;

/** HTML comments removed; `undefined` when only headings are left (an untouched template). */
export function contextBody(markdown: string | undefined): string | undefined {
	if (!markdown) return undefined;

	const body = markdown
		.replace(/<!--[\s\S]*?(?:-->|$)/g, "")
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	const hasContent = body.split("\n").some((line) => line.trim() && !HEADING.test(line));

	return hasContent ? body : undefined;
}
