import { readFileSync, rmSync, watch, type FSWatcher } from "fs";
import { basename, dirname, isAbsolute } from "path";
import { isNumber, isString } from "../../shared/guards";
import { isJsonObject } from "../../shared/json";
import { parseJson } from "../json";

export const OPEN_REQUEST_FILE = "open.json";

/** An older request is left over from a launch that failed */
export const OPEN_REQUEST_MAX_AGE_MS = 60_000;

/** Reads and removes the folder `rabisco open` asked for (decision 0030) */
export function takeOpenRequest(file: string, now = Date.now()): string | null {
	let text: string;

	try {
		text = readFileSync(file, "utf-8");
		rmSync(file, { force: true });
	} catch {
		return null;
	}

	try {
		const request = parseJson(text);

		if (!isJsonObject(request) || request["version"] !== 1) return null;
		const { path, at } = request;

		if (!isString(path) || !isAbsolute(path) || !isNumber(at)) return null;

		return now - at <= OPEN_REQUEST_MAX_AGE_MS && at <= now + OPEN_REQUEST_MAX_AGE_MS ? path : null;
	} catch {
		return null;
	}
}

/** Takes requests at launch and while the app runs; `onRequest` gets each folder */
export function watchOpenRequests(file: string, onRequest: (path: string) => void) {
	const check = () => {
		const path = takeOpenRequest(file);

		if (path) onRequest(path);
	};

	let watcher: FSWatcher | null = null;

	try {
		watcher = watch(dirname(file), (_event, name) => {
			if (name && String(name) === basename(file)) check();
		});
	} catch (error) {
		console.warn("Could not watch for open requests:", error);
	}

	check();

	return { check, close: () => watcher?.close() };
}
