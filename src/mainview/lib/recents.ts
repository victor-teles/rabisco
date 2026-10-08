import type { ProjectSummary } from "../../shared/types";

export type RecentsSort = "opened" | "edited" | "name";

export const RECENTS_SORTS: { value: RecentsSort; label: string }[] = [
	{ value: "opened", label: "Last opened" },
	{ value: "edited", label: "Last edited" },
	{ value: "name", label: "Name" },
];

export const isRecentsSort = (value: string | null): value is RecentsSort =>
	RECENTS_SORTS.some((sort) => sort.value === value);

/** Case- and accent-insensitive, so "cafe" finds "Café". */
const searchable = (text: string) =>
	text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();

/** `projects` comes most recently opened first; the query matches the name or the folder path. */
export function arrangeRecents(projects: ProjectSummary[], query: string, sort: RecentsSort): ProjectSummary[] {
	const terms = searchable(query).split(/\s+/).filter(Boolean);

	const matches = terms.length
		? projects.filter((project) => {
				const haystack = searchable(`${project.name} ${project.path}`);

				return terms.every((term) => haystack.includes(term));
			})
		: [...projects];

	if (sort === "name")
		matches.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }));
	else if (sort === "edited") matches.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

	return matches;
}
