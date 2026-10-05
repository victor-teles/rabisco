const ENTITIES = new Map(
	Object.entries({
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
		copy: "©",
		reg: "®",
		trade: "™",
		hellip: "…",
		mdash: "—",
		ndash: "–",
		middot: "·",
		bull: "•",
		rarr: "→",
		larr: "←",
		times: "×",
	}),
);

/** `&amp;`, `&#123;`, `&#x7B;` */
export function decodeEntities(text: string) {
	if (!text.includes("&")) return text;

	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
		if (body[0] === "#") {
			const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);

			return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
		}

		return ENTITIES.get(body.toLowerCase()) ?? match;
	});
}

/** As React renders it: lines trimmed and joined by one space, blank lines dropped */
export function jsxTextValue(raw: string) {
	const lines = raw.split(/\r?\n/);

	if (lines.length === 1) return decodeEntities(raw);
	const kept: string[] = [];
	lines.forEach((line, i) => {
		let text = line.replace(/\t/g, " ");

		if (i > 0) text = text.replace(/^\s+/, "");

		if (i < lines.length - 1) text = text.replace(/\s+$/, "");

		if (text) kept.push(text);
	});

	return decodeEntities(kept.join(" "));
}

/** `"Save"`, or `{"Say \"hi\""}` when plain quotes can't hold it */
export function attrValue(value: string) {
	return /["\n\r\\]|&(#?\w+);|[{}]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`;
}

/** Plain when possible, otherwise a string expression */
export function childText(value: string) {
	return /[{}<>&]|^\s|\s$|\n/.test(value) ? `{${JSON.stringify(value)}}` : value;
}

/** A tab, or the smallest space indent; tabs when unknown */
export function indentUnit(source: string) {
	let spaces = 0;

	for (const match of source.matchAll(/^([ \t]+)\S/gm)) {
		if (match[1]![0] === "\t") return "\t";
		const n = match[1]!.length;

		if (n >= 2 && (!spaces || n < spaces)) spaces = n;
	}

	return spaces ? " ".repeat(spaces) : "\t";
}

export const lineStart = (source: string, offset: number) => source.lastIndexOf("\n", offset - 1) + 1;

export function lineEnd(source: string, offset: number) {
	const end = source.indexOf("\n", offset);

	return end === -1 ? source.length : end;
}

export function indentAt(source: string, offset: number) {
	const start = lineStart(source, offset);

	return /^[ \t]*/.exec(source.slice(start, offset))![0];
}

export const startsLine = (source: string, offset: number) =>
	/^[ \t]*$/.test(source.slice(lineStart(source, offset), offset));

/** Skips the first line, which starts mid-line in its source. */
export function dedent(text: string, indent?: string) {
	const lines = text.split("\n");
	const rest = lines.slice(1).filter((line) => line.trim());

	const common =
		indent ??
		rest.reduce<string | null>((acc, line) => {
			const lead = /^[ \t]*/.exec(line)![0];

			if (acc === null) return lead;
			let n = 0;

			while (n < acc.length && n < lead.length && acc[n] === lead[n]) n++;

			return acc.slice(0, n);
		}, null) ??
		"";

	return lines
		.map((line, i) => (i > 0 && line.startsWith(common) ? line.slice(common.length) : i > 0 ? line.trimStart() : line))
		.join("\n");
}

/** With `unit`, the snippet's own indent levels are converted to it. */
export function reindent(snippet: string, indent: string, unit?: string) {
	const lines = snippet
		.replace(/^\s*\n/, "")
		.replace(/\s+$/, "")
		.split("\n");

	const leads = lines.filter((line) => line.trim()).map((line) => /^[ \t]*/.exec(line)![0]);
	let common = leads[0] ?? "";

	for (const lead of leads) while (!lead.startsWith(common)) common = common.slice(0, -1);
	const body = lines.map((line) => line.slice(common.length));
	const own = indentUnit(body.join("\n"));

	return body
		.map((line) => {
			if (!line.trim()) return "";

			if (!unit || own === unit) return indent + line;
			const lead = /^[ \t]*/.exec(line)![0];
			const levels = Math.round(lead.replace(/\t/g, own === "\t" ? "\t" : own).length / own.length);

			return indent + unit.repeat(levels) + line.slice(lead.length);
		})
		.join("\n");
}

/** `stat-card` → `StatCard`; empty when nothing usable is left */
export function toPascal(text: string) {
	const words = text
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);

	const name = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");

	return /^[A-Z]/.test(name) ? name : "";
}

/** `StatCard` → `Stat card` */
export function toSentence(pascal: string) {
	const words = pascal.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

	return words[0] ? words[0].toUpperCase() + words.slice(1) : words;
}
