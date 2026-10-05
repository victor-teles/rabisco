/** A Markdown heading line (ATX style, up to 3 spaces of indent) */
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;

/**
 * What a context file (PRODUCT.md, DESIGN.md) actually says: HTML comments
 * removed and trimmed. `undefined` when only headings and blank lines are
 * left, as in an untouched template, whose guidance lives in comments.
 */
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
