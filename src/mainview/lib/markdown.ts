// The small Markdown subset model replies use. It parses to a tree that React renders, so no HTML ever goes in.

export type Inline =
	| { type: "text"; text: string }
	| { type: "code"; text: string }
	| { type: "strong"; children: Inline[] }
	| { type: "em"; children: Inline[] }
	/** Only `http(s):` and `mailto:` links; any other target stays text */
	| { type: "link"; href: string; children: Inline[] };

export type Block =
	| { type: "heading"; children: Inline[] }
	/** Line breaks inside a paragraph are kept */
	| { type: "paragraph"; children: Inline[] }
	| { type: "list"; ordered: boolean; start: number; items: Inline[][] }
	/** An unclosed fence runs to the end, so a streaming reply renders as it grows */
	| { type: "code"; text: string }
	| { type: "quote"; children: Inline[] };

const FENCE = /^\s*(```|~~~)/;

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

const LIST_ITEM = /^\s*(?:([-*+•])|(\d{1,9})[.)])\s+(.*)$/;

const QUOTE = /^\s{0,3}>\s?(.*)$/;

const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

const INLINE =
	/`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*(?=\S)([^*]*?\S)\*\*|__(?=\S)([^_]*?\S)__|\*(?=[^\s*])([^*\n]*?[^\s*])\*|(?<!\w)_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g;

const startsBlock = (line: string) =>
	FENCE.test(line) || HEADING.test(line) || LIST_ITEM.test(line) || QUOTE.test(line);

export function parseInline(text: string): Inline[] {
	const out: Inline[] = [];
	let at = 0;

	for (const match of text.matchAll(INLINE)) {
		const index = match.index;

		if (index > at) out.push({ type: "text", text: text.slice(at, index) });
		at = index + match[0].length;
		const [, code, label, href, strong, strongAlt, em, emAlt] = match;

		if (code !== undefined) out.push({ type: "code", text: code });
		else if (label !== undefined && href !== undefined) {
			const children = parseInline(label);

			if (SAFE_LINK.test(href)) out.push({ type: "link", href, children });
			else out.push(...children);
		} else if (strong !== undefined || strongAlt !== undefined)
			out.push({ type: "strong", children: parseInline(strong ?? strongAlt ?? "") });
		else out.push({ type: "em", children: parseInline(em ?? emAlt ?? "") });
	}

	if (at < text.length) out.push({ type: "text", text: text.slice(at) });

	return out;
}

export function parseMarkdown(source: string): Block[] {
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	const blocks: Block[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i]!;

		if (!line.trim()) {
			i += 1;
			continue;
		}

		const fence = FENCE.exec(line);

		if (fence) {
			const body: string[] = [];
			i += 1;

			while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) {
				body.push(lines[i]!);
				i += 1;
			}

			i += 1;
			blocks.push({ type: "code", text: body.join("\n") });
			continue;
		}

		const heading = HEADING.exec(line);

		if (heading) {
			blocks.push({ type: "heading", children: parseInline(heading[1]!) });
			i += 1;
			continue;
		}

		const item = LIST_ITEM.exec(line);

		if (item) {
			const ordered = item[2] !== undefined;
			const items: string[] = [];

			while (i < lines.length) {
				const next = LIST_ITEM.exec(lines[i]!);

				if (next && (next[2] !== undefined) === ordered) items.push(next[3]!);
				else if (!next && items.length && /^\s+\S/.test(lines[i]!) && !startsBlock(lines[i]!))
					items[items.length - 1] += `\n${lines[i]!.trim()}`;
				else break;
				i += 1;
			}

			blocks.push({
				type: "list",
				ordered,
				start: ordered ? Number(item[2]) : 1,
				items: items.map((text) => parseInline(text)),
			});
			continue;
		}

		if (QUOTE.test(line)) {
			const quoted: string[] = [];

			for (let quote = QUOTE.exec(lines[i] ?? ""); quote; quote = QUOTE.exec(lines[i] ?? "")) {
				quoted.push(quote[1]!);
				i += 1;
			}

			blocks.push({ type: "quote", children: parseInline(quoted.join("\n")) });
			continue;
		}

		const paragraph = [line];
		i += 1;

		while (i < lines.length && lines[i]!.trim() && !startsBlock(lines[i]!)) {
			paragraph.push(lines[i]!);
			i += 1;
		}

		blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
	}

	return blocks;
}
