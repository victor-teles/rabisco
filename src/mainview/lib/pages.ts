import { boundsOf, intersects } from "@/lib/align";
import type { Snapshot } from "@/lib/history";
import { removeImage } from "@/lib/moodboard";
import { MAX_PAGE_NAME, onPage, pageOf, withPage } from "../../shared/pages";
import { nextFrameX } from "../../shared/project";
import type { CanvasPage } from "../../shared/types";
import { baseOf } from "../../shared/variations";

type Tagged = { page?: string };

function tagged<T extends Tagged>(
	before: T[] | undefined,
	after: T[] | undefined,
	key: (item: T) => string,
	page: string,
	pages: readonly CanvasPage[],
	skip: (item: T) => boolean = () => false,
): T[] | undefined {
	if (!after || after === before) return after;
	const known = new Set((before ?? []).map(key));
	const lost = (item: T) => !known.has(key(item)) && !skip(item) && !pages.some((each) => each.id === item.page);

	if (!after.some(lost)) return after;

	return after.map((item) => (lost(item) ? { ...item, page } : item));
}

/** New screens, sections, images, notes and loose comments go on the open page, whichever path made them */
export function onOpenPage(present: Snapshot, next: Snapshot, page: string | undefined): Snapshot {
	const pages = next.pages ?? [];

	if (!page || !pages.length || next === present) return next;
	const frames = tagged(present.frames, next.frames, (frame) => frame.file, page, pages) ?? next.frames;
	const sections = tagged(present.sections, next.sections, (section) => section.id, page, pages);
	const images = tagged(present.images, next.images, (image) => image.id, page, pages);
	const annotations = tagged(present.annotations, next.annotations, (annotation) => annotation.id, page, pages);
	const loose = (comment: { file?: string }) => comment.file !== undefined;
	const comments = tagged(present.comments, next.comments, (comment) => comment.id, page, pages, loose);

	if (
		frames === next.frames &&
		sections === next.sections &&
		images === next.images &&
		annotations === next.annotations &&
		comments === next.comments
	)
		return next;

	return { ...next, frames, sections, images, annotations, comments };
}

/** The first extra page also names the page everything was on, and tags it all with it */
export function addPage(snapshot: Snapshot, page: CanvasPage, firstId: string): Snapshot {
	const pages = snapshot.pages ?? [];

	if (pages.length) return { ...snapshot, pages: [...pages, page] };

	const loose = (snapshot.comments ?? []).map((comment) =>
		comment.file || comment.page ? comment : { ...comment, page: firstId },
	);

	return {
		...snapshot,
		pages: [{ id: firstId, name: "Page 1" }, page],
		frames: withPage(snapshot.frames, firstId) ?? snapshot.frames,
		sections: withPage(snapshot.sections, firstId),
		images: withPage(snapshot.images, firstId),
		annotations: withPage(snapshot.annotations, firstId),
		comments: loose,
	};
}

export function renamePage(snapshot: Snapshot, id: string, name: string): Snapshot {
	const pages = snapshot.pages ?? [];
	const next = name.trim().slice(0, MAX_PAGE_NAME);

	if (!next || !pages.some((page) => page.id === id && page.name !== next)) return snapshot;

	return { ...snapshot, pages: pages.map((page) => (page.id === id ? { ...page, name: next } : page)) };
}

/** With everything on it: its screens' files, sections, images, notes and comments. The last page stays */
export function deletePage(snapshot: Snapshot, id: string): Snapshot {
	const pages = snapshot.pages ?? [];

	if (pages.length < 2 || !pages.some((page) => page.id === id)) return snapshot;
	const on = (item: { page?: string }) => pageOf(item, pages) === id;
	const doomed = new Set(snapshot.frames.flatMap((frame) => (on(frame) ? [frame.file] : [])));

	let next: Snapshot = {
		...snapshot,
		pages: pages.filter((page) => page.id !== id),
		frames: snapshot.frames.filter((frame) => !doomed.has(frame.file)),
		files: Object.fromEntries(Object.entries(snapshot.files).filter(([path]) => !doomed.has(path))),
		sections: snapshot.sections?.filter((section) => !on(section)),
		annotations: snapshot.annotations?.filter((annotation) => !on(annotation)),
		comments: (snapshot.comments ?? []).filter((comment) => (comment.file ? !doomed.has(comment.file) : !on(comment))),
	};

	for (const image of snapshot.images ?? []) if (on(image)) next = removeImage(next, image.id);

	return next;
}

/** Alternates go with their screen. They keep their place unless it overlaps the page's screens */
export function moveToPage(snapshot: Snapshot, files: string[], target: string): Snapshot {
	const pages = snapshot.pages ?? [];

	if (!pages.some((page) => page.id === target)) return snapshot;
	const bases = new Set(files.map(baseOf));
	const moving = snapshot.frames.filter((frame) => bases.has(baseOf(frame.file)) && pageOf(frame, pages) !== target);
	const bounds = boundsOf(moving);

	if (!bounds) return snapshot;
	const there = onPage(snapshot.frames, pages, target);
	const dx = there.some((frame) => intersects(frame, bounds)) ? nextFrameX(there) - bounds.x : 0;
	const moved = new Set(moving.map((frame) => frame.file));

	return {
		...snapshot,
		frames: snapshot.frames.map((frame) =>
			moved.has(frame.file) ? { ...frame, page: target, x: frame.x + dx } : frame,
		),
	};
}
