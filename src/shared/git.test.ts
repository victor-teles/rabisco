import { describe, expect, test } from "bun:test";
import { commitMessage, redactRemoteUrl } from "./git";

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
		expect(subject([{ status: "M", path: "rabisco.json" }, { status: "M", path: "chat.jsonl" }])).toBe("Rabisco: update the canvas");
		expect(subject([{ status: "M", path: "chat.jsonl" }])).toBe("Rabisco: update the chat");
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
