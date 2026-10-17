import { isString } from "./guards";
import { isJsonArray, isJsonObject, type Json } from "./json";
import type { CanvasDoc, CanvasPage, Frame } from "./types";

type OnPage = { page?: string };

export const MAX_PAGE_NAME = 80;

export function normalizePages(raw: Json | undefined): CanvasPage[] {
	if (!isJsonArray(raw)) return [];
	const seen = new Set<string>();
	const pages: CanvasPage[] = [];

	for (const entry of raw) {
		if (!isJsonObject(entry) || !isString(entry.id) || !entry.id || seen.has(entry.id)) continue;
		seen.add(entry.id);
		const name = isString(entry.name) ? entry.name.trim().slice(0, MAX_PAGE_NAME) : "";
		pages.push({ id: entry.id, name: name || `Page ${pages.length + 1}` });
	}

	return pages;
}

/** `undefined` while the project has one page */
export function pageOf(item: OnPage, pages: readonly CanvasPage[]): string | undefined {
	if (!pages.length) return undefined;

	return item.page !== undefined && pages.some((page) => page.id === item.page) ? item.page : pages[0]!.id;
}

/** The saved page when it still exists, else the first */
export function openPage(canvas: Pick<CanvasDoc, "pages" | "page">): string | undefined {
	return pageOf({ page: canvas.page }, canvas.pages ?? []);
}

export function onPage<T extends OnPage>(items: T[], pages: readonly CanvasPage[], page: string | undefined): T[] {
	if (!pages.length) return items;

	return items.filter((item) => pageOf(item, pages) === page);
}

/** Where new screens are placed: beside the open page's screens only */
export const openPageFrames = (canvas: Pick<CanvasDoc, "frames" | "pages" | "page">): Frame[] =>
	onPage(canvas.frames, canvas.pages ?? [], openPage(canvas));

export function nextPageName(pages: readonly CanvasPage[]) {
	const taken = new Set(pages.map((page) => page.name));
	let n = pages.length + 1;

	while (taken.has(`Page ${n}`)) n++;

	return `Page ${n}`;
}

/** Every item says its page, so reordering or deleting pages never moves an untagged one */
export function withPage<T extends OnPage>(items: T[] | undefined, page: string): T[] | undefined {
	if (!items?.some((item) => item.page === undefined)) return items;

	return items.map((item) => (item.page === undefined ? { ...item, page } : item));
}
