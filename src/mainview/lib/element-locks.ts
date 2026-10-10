import { findElement, parseJsx, type JsxElement } from "../../shared/jsx";
import { lockKey } from "../../shared/locks";
import type { ElementLock, ProjectFiles } from "../../shared/types";
import { atPath, pathOf, remapStart } from "./outline";

export function lockOf(file: string, source: string, start: number): ElementLock | null {
	const tree = parseJsx(source);
	const element = tree.ok ? findElement(tree, start) : null;
	const path = element?.name ? pathOf(tree, start) : null;

	return element?.name && path ? { file, path, name: element.name } : null;
}

function resolve(lock: ElementLock, source: string): JsxElement | null {
	const tree = parseJsx(source);
	const element = tree.ok ? atPath(tree, lock.path) : null;

	return element?.name === lock.name ? element : null;
}

export function lockedStarts(locks: readonly ElementLock[] | undefined, file: string, source: string): number[] {
	return (locks ?? []).flatMap((lock) => (lock.file === file ? (resolve(lock, source)?.start ?? []) : []));
}

export function isLocked(source: string, locked: readonly number[], start: number): boolean {
	if (!locked.length) return false;

	for (let at = findElement(parseJsx(source), start); at; at = at.parent) if (locked.includes(at.start)) return true;

	return false;
}

export function unlockedStarts(source: string, locked: readonly number[], starts: readonly number[]): number[] {
	return starts.filter((start) => !isLocked(source, locked, start));
}

export function toggleLocks(
	locks: readonly ElementLock[],
	file: string,
	source: string,
	starts: readonly number[],
): ElementLock[] {
	const targets = starts.flatMap((start) => lockOf(file, source, start) ?? []);
	const keys = new Set(targets.map(lockKey));
	const held = new Set(locks.map(lockKey));
	const others = locks.filter((lock) => !keys.has(lockKey(lock)));

	if (targets.every((lock) => held.has(lockKey(lock)))) return others;

	return [...others, ...targets];
}

function follow(lock: ElementLock, before: string, after: string | undefined): ElementLock | null {
	if (after === undefined) return null;

	if (after === before || !parseJsx(before).ok || !parseJsx(after).ok) return lock;
	const element = resolve(lock, before);
	const start = element ? remapStart(before, after, element.start) : null;

	return start === null ? null : lockOf(lock.file, after, start);
}

export function remapLocks(locks: ElementLock[], before: ProjectFiles, after: ProjectFiles): ElementLock[] {
	if (before === after || !locks.length) return locks;
	let changed = false;

	const next = locks.flatMap((lock) => {
		const source = before[lock.file];
		const moved = source === undefined ? lock : follow(lock, source, after[lock.file]);

		if (moved !== lock && (moved === null || lockKey(moved) !== lockKey(lock) || moved.name !== lock.name))
			changed = true;

		return moved ?? [];
	});

	return changed ? next : locks;
}

export function isElementLocked(
	locks: readonly ElementLock[] | undefined,
	file: string,
	source: string | undefined,
	start: number,
): boolean {
	return source !== undefined && isLocked(source, lockedStarts(locks, file, source), start);
}
