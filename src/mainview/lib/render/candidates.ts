import type { ProjectFiles } from "../../../shared/types";

const BRACKETED = /\[[^[\]]*\]|\([^()]*\)/g;

/** Outside brackets Tailwind only uses lowercase, digits and these few symbols */
const BARE = /^[!-]?[a-z0-9_@*][a-z0-9_\-:/.!@*%]*$/;

function couldBeClass(token: string) {
	if (token.length < 2 || token.length > 119 || !/^[!-]?[a-z@[*]/.test(token)) return false;
	let bare = token;

	for (let last = ""; last !== bare;) {
		last = bare;
		bare = bare.replace(BRACKETED, "_");
	}

	if (!BARE.test(bare) || /[-:/.]$/.test(bare) || bare.includes("//")) return false;

	// Dots only sit inside numbers (`p-0.5`); `props.title` and `./file` are code
	if (/\D\.|\.\D/.test(bare)) return false;

	// One slash per variant segment at most: `bg-black/50`, not `components/ui/button`
	return bare.split(":").every((segment) => segment.indexOf("/") === segment.lastIndexOf("/"));
}

/** A cheap superset of the classes in a source; tokens Tailwind could never accept are dropped. */
export function extractCandidates(source: string): string[] {
	const set = new Set<string>();

	const add = (token: string) => {
		if (!set.has(token) && couldBeClass(token)) set.add(token);
	};

	for (const token of source.split(/[\s"'`]+/)) {
		add(token);

		if (/[{}();,=<>]/.test(token)) for (const part of token.split(/[{}();,=<>]+/)) add(part);
	}

	return [...set];
}

const SCRIPT = /\.(tsx|jsx|ts|js)$/;

/** Every script's candidates, so a project's first build covers all its screens. */
export function projectCandidates(files: ProjectFiles): string[] {
	const set = new Set<string>();

	for (const [path, source] of Object.entries(files)) {
		if (SCRIPT.test(path)) for (const candidate of extractCandidates(source)) set.add(candidate);
	}

	return [...set];
}
