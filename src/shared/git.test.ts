import { describe, expect, test } from "bun:test";
import {
	checkpointMessage,
	checkpointScope,
	cleanCheckpointName,
	commitMessage,
	parseCheckpoints,
	redactRemoteUrl,
} from "./git";

const subject = (changes: Parameters<typeof commitMessage>[0]) => commitMessage(changes).split("\n")[0];

describe("commitMessage", () => {
	test("names one screen, counts several", () => {
		expect(subject([{ status: "M", path: "screens/order-history.tsx" }])).toBe("Rabisco: update order history screen");
		expect(
			subject([
				{ status: "M", path: "screens/a.tsx" },
				{ status: "M", path: "screens/b.tsx" },
				{ status: "M", path: "screens/c.tsx" },
			]),
		).toBe("Rabisco: update 3 screens");
	});

	test("groups by what happened, then components and context", () => {
		expect(
			subject([
				{ status: "?", path: "screens/new.tsx" },
				{ status: "D", path: "screens/old.tsx" },
				{ status: "A", path: "components/button.tsx" },
				{ status: "M", path: "DESIGN.md" },
			]),
		).toBe("Rabisco: add new screen, remove old screen, add button component, more");
	});

	test("canvas, chat and other files", () => {
		expect(
			subject([
				{ status: "M", path: "rabisco.json" },
				{ status: "M", path: "chat.jsonl" },
			]),
		).toBe("Rabisco: update the canvas");
		expect(subject([{ status: "M", path: "chat.jsonl" }])).toBe("Rabisco: update the chat");
		expect(
			subject([
				{ status: "M", path: "chat.jsonl" },
				{ status: "?", path: "attachments/a-0.png" },
			]),
		).toBe("Rabisco: update the chat");
		expect(subject([{ status: "?", path: ".gitignore" }])).toBe("Rabisco: update 1 other file");
	});

	test("the body lists every file", () => {
		const message = commitMessage([
			{ status: "M", path: "screens/b.tsx" },
			{ status: "?", path: "DESIGN.md" },
		]);

		expect(message).toBe("Rabisco: update b screen, update DESIGN.md\n\n- add DESIGN.md\n- update screens/b.tsx\n");
	});
});

test("redactRemoteUrl drops credentials", () => {
	expect(redactRemoteUrl("https://user:token@github.com/me/app.git")).toBe("https://github.com/me/app.git");
	expect(redactRemoteUrl("git@github.com:me/app.git")).toBe("git@github.com:me/app.git");
	expect(redactRemoteUrl("/tmp/remote.git")).toBe("/tmp/remote.git");
});

describe("checkpoints", () => {
	test("the message names the checkpoint, lists the files and ends with the trailer", () => {
		expect(checkpointMessage("  Before   the\nredesign ", [{ status: "?", path: "screens/home.tsx" }], ".")).toBe(
			"Rabisco checkpoint: Before the redesign\n\n- add screens/home.tsx\n\nRabisco-Checkpoint: .\n",
		);
		expect(checkpointMessage("Clean", [], "design/app")).toBe(
			"Rabisco checkpoint: Clean\n\nRabisco-Checkpoint: design/app\n",
		);
	});

	test("the scope is the project folder in the repository", () => {
		expect(checkpointScope("")).toBe(".");
		expect(checkpointScope("design/app.rabisco/")).toBe("design/app.rabisco");
	});

	test("names are one line and capped", () => {
		expect(cleanCheckpointName(" a\t b ")).toBe("a b");
		expect(cleanCheckpointName("x".repeat(300))).toHaveLength(120);
	});

	test("parsing keeps this project's checkpoints only", () => {
		const record = (hash: string, subject: string, trailer: string) =>
			[hash, hash.slice(0, 7), "2026-10-10T12:00:00Z", subject, trailer].join("\0");

		const output = [
			record("a".repeat(40), "Rabisco checkpoint: Mine", "design/app"),
			record("b".repeat(40), "Rabisco checkpoint: Other", "design/app2"),
			record("c".repeat(40), "Rabisco: update the canvas", "design/app"),
		].join("\x1e\n");

		expect(parseCheckpoints(output, "design/app")).toEqual([
			{ hash: "a".repeat(40), short: "aaaaaaa", date: "2026-10-10T12:00:00Z", name: "Mine" },
		]);
	});
});
