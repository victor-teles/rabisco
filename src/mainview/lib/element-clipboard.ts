import type { LibraryImport } from "../../shared/components/library";
import { addImport, isElementCode, pasteElement, readImports } from "../../shared/jsx";

/** Element code and the named imports it uses, so a paste into another screen still compiles */
export type ElementCopy = { code: string; imports: LibraryImport[] };

/** Plain named imports only: `addImport` can't write default, namespace or renamed ones */
export function usedImports(source: string, code: string): LibraryImport[] {
	return readImports(source).flatMap((decl) => {
		if (decl.typeOnly) return [];

		const names = decl.named.flatMap((specifier) =>
			!specifier.type &&
			specifier.imported === specifier.local &&
			new RegExp(`(?<![\\w$.])${specifier.local.replace(/\$/g, "\\$")}(?![\\w$])`).test(code)
				? [specifier.local]
				: [],
		);

		return names.length ? [{ from: decl.module, names }] : [];
	});
}

/** Pastes after or into the element at `start` (see `pasteElement`) and adds the imports. `start` is the first pasted element's offset in the final source. */
export function pasteCopy(source: string, start: number, copy: ElementCopy): { source: string; start: number } | null {
	const pasted = pasteElement(source, start, copy.code);

	if (!pasted) return null;
	let next = pasted.source;

	for (const { from, names } of copy.imports) next = addImport(next, from, names);

	// Imports only go above the screen's JSX, so they shift it by what they added
	return { source: next, start: pasted.start + next.length - pasted.source.length };
}

/** The last copy, so its imports come along when the clipboard still holds its code */
let copied: ElementCopy | null = null;

/** The system clipboard gets the code alone, so it pastes into an editor too */
export function writeElement(copy: ElementCopy) {
	copied = copy;

	return navigator.clipboard.writeText(copy.code);
}

/** Element code copied here or from an editor; `null` when the clipboard holds something else, such as screens */
export async function readElement(): Promise<ElementCopy | null> {
	const text = await navigator.clipboard.readText().catch(() => null);

	if (copied && (text === null || text === copied.code)) return copied;

	return text !== null && isElementCode(text) ? { code: text.trim(), imports: [] } : null;
}
