import { describe, expect, test } from "bun:test";
import {
	draftIdOf,
	DRAFTS_KEY,
	type DraftStorage,
	MAX_DRAFTS,
	parseDrafts,
	readDraft,
	saveDraft,
	withDraft,
} from "./composer-drafts";

function memoryStorage(): DraftStorage & { writes: number } {
	const items = new Map<string, string>();

	return {
		writes: 0,
		getItem: (key) => items.get(key) ?? null,
		setItem(key, value) {
			this.writes++;
			items.set(key, value);
		},
	};
}

describe("composer drafts", () => {
	test("keeps a draft per project and chat", () => {
		const storage = memoryStorage();
		const a = draftIdOf("/p/a", "chat-1");
		const b = draftIdOf("/p/a", "chat-2");
		const c = draftIdOf("/p/b", "chat-1");

		saveDraft(storage, a, "A login screen", 1);
		saveDraft(storage, b, "A settings screen", 2);

		expect(readDraft(storage, a)).toBe("A login screen");
		expect(readDraft(storage, b)).toBe("A settings screen");
		expect(readDraft(storage, c)).toBe("");
	});

	test("an empty draft is removed, and saving the same text writes nothing", () => {
		const storage = memoryStorage();
		const id = draftIdOf("/p/a", "chat-1");

		saveDraft(storage, id, "Hello", 1);
		saveDraft(storage, id, "Hello", 2);
		expect(storage.writes).toBe(1);

		saveDraft(storage, id, "  ", 3);
		expect(readDraft(storage, id)).toBe("");
		expect(parseDrafts(storage.getItem(DRAFTS_KEY))).toEqual({});
	});

	test("keeps only the newest drafts", () => {
		let drafts = {};

		for (let i = 0; i <= MAX_DRAFTS; i++) drafts = withDraft(drafts, `id-${i}`, `text ${i}`, i);

		expect(Object.keys(drafts)).toHaveLength(MAX_DRAFTS);
		expect(Object.keys(drafts)).not.toContain("id-0");
		expect(Object.keys(drafts)).toContain(`id-${MAX_DRAFTS}`);
	});

	test("ignores stored values it can't read", () => {
		expect(parseDrafts("not json")).toEqual({});
		expect(parseDrafts("[]")).toEqual({});
		expect(parseDrafts('{"a":{"text":1,"savedAt":2},"b":{"text":"ok","savedAt":3}}')).toEqual({
			b: { text: "ok", savedAt: 3 },
		});
	});
});
