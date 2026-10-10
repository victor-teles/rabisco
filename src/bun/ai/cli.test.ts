import { describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "fs";
import { join } from "path";
import type { GenerationEvent } from "../../shared/ai/contract";
import { objectOr, optionalString } from "../json";
import { tempDir } from "../test-utils";
import {
	classifyFailure,
	type LineMapper,
	MessageText,
	parseVersion,
	readLines,
	resolveBinary,
	runCliAgent,
	stagingRelative,
} from "./cli";
import { fakeSpawn } from "./providers/fake-cli";

const collect = async (events: AsyncIterable<GenerationEvent>) => {
	const out: GenerationEvent[] = [];

	for await (const event of events) out.push(event);

	return out;
};

function executable(dir: string, name: string) {
	const path = join(dir, name);
	writeFileSync(path, "#!/bin/sh\necho 1.0.0\n");
	chmodSync(path, 0o755);

	return path;
}

describe("resolveBinary", () => {
	test("prefers binPath, then PATH, then common dirs", () => {
		const a = tempDir();
		const b = tempDir();
		const onPath = executable(a, "tool");
		const common = executable(b, "tool");
		const custom = executable(b, "custom-tool");
		expect(resolveBinary("tool", custom, { path: a, dirs: [b] })).toBe(custom);
		expect(resolveBinary("tool", undefined, { path: a, dirs: [b] })).toBe(onPath);
		expect(resolveBinary("tool", undefined, { path: "", dirs: [b] })).toBe(common);
		expect(resolveBinary("missing", undefined, { path: a, dirs: [b] })).toBeNull();
		expect(resolveBinary("tool", join(b, "nope"), { path: a, dirs: [b] })).toBeNull();
	});

	test("skips files that aren't executable", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "tool"), "");
		expect(resolveBinary("tool", undefined, { path: dir, dirs: [] })).toBeNull();
	});
});

describe("classifyFailure", () => {
	test("maps common CLI errors", () => {
		expect(classifyFailure("claude-code", "Invalid API key · Please run /login")).toMatchObject({
			code: "not_authenticated",
			fix: "Run `claude` in a terminal and log in.",
		});
		expect(classifyFailure("codex", "Error: Not logged in")).toMatchObject({
			code: "not_authenticated",
			fix: "Run `codex login` in a terminal.",
		});
		expect(classifyFailure("gemini-cli", "Please set an Auth method in your settings")).toMatchObject({
			code: "not_authenticated",
		});
		expect(classifyFailure("claude-code", "API Error: 429 rate_limit_error")).toMatchObject({
			code: "rate_limited",
			retryable: true,
		});
		expect(classifyFailure("codex", "You've hit your usage limit.")).toMatchObject({ code: "rate_limited" });
		expect(classifyFailure("claude-code", "Prompt is too long")).toMatchObject({ code: "context_too_large" });
		expect(classifyFailure("codex", "getaddrinfo ENOTFOUND api.openai.com")).toMatchObject({
			code: "network",
			retryable: true,
		});
		expect(classifyFailure("codex", "segfault")).toMatchObject({ code: "unknown", message: "segfault" });
	});
});

test("readLines splits chunks into lines", async () => {
	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			for (const part of ['{"a":', '1}\n{"b"', ":2}\r\nlast"]) c.enqueue(new TextEncoder().encode(part));
			c.close();
		},
	});

	const lines: string[] = [];

	for await (const line of readLines(stream)) lines.push(line);
	expect(lines).toEqual(['{"a":1}', '{"b":2}', "last"]);
});

test("parseVersion", () => {
	expect(parseVersion("2.1.289 (Claude Code)")).toBe("2.1.289");
	expect(parseVersion("codex-cli 0.155.1")).toBe("0.155.1");
});

test("MessageText separates blocks with a blank line", () => {
	const text = new MessageText();
	text.break();
	expect(text.delta("One")).toEqual([{ type: "message.delta", text: "One" }]);
	expect(text.delta(" more")).toEqual([{ type: "message.delta", text: " more" }]);
	text.break();
	expect(text.delta("Two")).toEqual([{ type: "message.delta", text: "\n\nTwo" }]);
});

test("stagingRelative strips the staging dir, including the macOS /private prefix", () => {
	expect(stagingRelative("/var/x", "/var/x/screens/a.tsx")).toBe("screens/a.tsx");
	expect(stagingRelative("/var/x", "/private/var/x/screens/a.tsx")).toBe("screens/a.tsx");
	expect(stagingRelative("/var/x", "screens/a.tsx")).toBe("screens/a.tsx");
});

describe("runCliAgent", () => {
	const map: LineMapper = (line) => {
		const kind = optionalString(objectOr(line).kind) ?? "";

		return kind === "end" ? [{ type: "done" }] : [{ type: "status", label: kind }];
	};

	test("maps lines, ignores non-JSON noise and stops at the first terminal event", async () => {
		const { spawn } = fakeSpawn({ stdout: ["warming up", { kind: "a" }, { kind: "end" }, { kind: "after" }] });

		const events = await collect(
			runCliAgent({ type: "codex", spawn, cmd: ["codex"], cwd: "/tmp", map }, new AbortController().signal),
		);

		expect(events).toEqual([{ type: "status", label: "a" }, { type: "done" }]);
	});

	test("a non-zero exit without a terminal event becomes a mapped error", async () => {
		const { spawn } = fakeSpawn({ stdout: [{ kind: "a" }], stderr: "Error: not logged in", exitCode: 1 });

		const events = await collect(
			runCliAgent({ type: "claude-code", spawn, cmd: ["claude"], cwd: "/tmp", map }, new AbortController().signal),
		);

		expect(events.at(-1)).toMatchObject({ type: "error", code: "not_authenticated" });
	});

	test("a missing binary is not_installed", async () => {
		const error = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		const { spawn } = fakeSpawn({ throws: error });

		const events = await collect(
			runCliAgent({ type: "gemini-cli", spawn, cmd: ["gemini"], cwd: "/tmp", map }, new AbortController().signal),
		);

		expect(events).toEqual([expect.objectContaining({ type: "error", code: "not_installed" })]);
	});

	test("abort kills the process and ends with aborted", async () => {
		const { spawn, calls } = fakeSpawn({ stdout: [{ kind: "a" }], hang: true });
		const controller = new AbortController();
		const events: GenerationEvent[] = [];

		for await (const event of runCliAgent(
			{ type: "codex", spawn, cmd: ["codex"], cwd: "/tmp", map },
			controller.signal,
		)) {
			events.push(event);
			controller.abort();
		}

		expect(events).toEqual([
			{ type: "status", label: "a" },
			expect.objectContaining({ type: "error", code: "aborted" }),
		]);
		expect(calls[0]!.killed).toContain("SIGTERM");
	});
});
