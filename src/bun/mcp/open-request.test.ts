import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tempDir } from "../test-utils";
import { OPEN_REQUEST_FILE, takeOpenRequest, watchOpenRequests } from "./open-request";

const NOW = 1_800_000_000_000;

const request = (path: string, at = NOW) => JSON.stringify({ version: 1, path, at });

describe("takeOpenRequest", () => {
	test("reads the folder once and removes the file", () => {
		const file = join(tempDir(), OPEN_REQUEST_FILE);
		writeFileSync(file, request("/work/shop"));

		expect(takeOpenRequest(file, NOW + 1000)).toBe("/work/shop");
		expect(existsSync(file)).toBe(false);
		expect(takeOpenRequest(file, NOW)).toBeNull();
	});

	test("ignores old, relative and broken requests, and still removes them", () => {
		const file = join(tempDir(), OPEN_REQUEST_FILE);

		for (const text of [request("/work/shop", NOW - 120_000), request("work/shop"), "{", "[]"]) {
			writeFileSync(file, text);
			expect(takeOpenRequest(file, NOW)).toBeNull();
			expect(existsSync(file)).toBe(false);
		}
	});
});

describe("watchOpenRequests", () => {
	test("takes a request left before launch and the ones that come later", async () => {
		const file = join(tempDir(), OPEN_REQUEST_FILE);
		writeFileSync(file, request("/work/first", Date.now()));
		const seen: string[] = [];
		const watcher = watchOpenRequests(file, (path) => seen.push(path));

		expect(seen).toEqual(["/work/first"]);
		writeFileSync(file, request("/work/second", Date.now()));

		for (let tries = 0; tries < 50 && seen.length < 2; tries++) await Bun.sleep(20);
		watcher.close();
		expect(seen).toEqual(["/work/first", "/work/second"]);
	});
});
