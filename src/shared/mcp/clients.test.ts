import { describe, expect, test } from "bun:test";
import { clientOfName } from "./clients";

describe("clientOfName", () => {
	test("maps each client's clientInfo name", () => {
		expect(clientOfName("claude-code")).toBe("claude-code");
		expect(clientOfName("codex-mcp-client")).toBe("codex");
		expect(clientOfName("cursor-vscode")).toBe("cursor");
		expect(clientOfName("Visual Studio Code - Insiders")).toBe("vscode");
		expect(clientOfName("claude-ai")).toBe("claude-desktop");
		expect(clientOfName("agent")).toBeNull();
	});
});
