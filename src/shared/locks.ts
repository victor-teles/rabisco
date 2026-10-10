import { isFiniteNumber, isString } from "./guards";
import { isJsonArray, isJsonObject, type Json } from "./json";
import type { ElementLock } from "./types";

const isIndex = (value: Json): value is number => isFiniteNumber(value) && Number.isInteger(value) && value >= 0;

export const lockKey = (lock: ElementLock) => `${lock.file}\n${lock.path.join(".")}`;

export function normalizeLocks(raw: Json | undefined): ElementLock[] {
	if (!isJsonArray(raw)) return [];
	const seen = new Set<string>();
	const locks: ElementLock[] = [];

	for (const entry of raw) {
		if (!isJsonObject(entry) || !isString(entry.file) || !isString(entry.name) || !isJsonArray(entry.path)) continue;
		const path = entry.path.filter(isIndex);

		if (!path.length || path.length !== entry.path.length) continue;
		const lock: ElementLock = { file: entry.file, path, name: entry.name };

		if (seen.has(lockKey(lock))) continue;
		seen.add(lockKey(lock));
		locks.push(lock);
	}

	return locks;
}
