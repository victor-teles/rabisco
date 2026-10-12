import { describe, expect, test } from "bun:test";
import type { ToolResult } from "../../shared/mcp/tools";
import { createAgentOpener } from "./agent-open";

const textOf = (result: ToolResult) => (result.content[0]?.type === "text" ? result.content[0].text : "");

describe("createAgentOpener", () => {
	test("routes to the editor and answers once the project loads", async () => {
		const opener = createAgentOpener();
		const routed: string[] = [];
		opener.handleOpen((path) => routed.push(path));

		const pending = opener.open({ path: "/work/shop/" });
		expect(routed).toEqual(["/work/shop"]);
		opener.editorProject("/work/shop", null);
		opener.editorProject("/work/shop", { name: "Shop" });

		const result = await pending;
		expect(result.isError).toBeUndefined();
		expect(JSON.parse(textOf(result))).toEqual({ name: "Shop", path: "/work/shop" });
	});

	test("answers right away when the editor already shows the project", async () => {
		const opener = createAgentOpener();
		const routed: string[] = [];
		opener.handleOpen((path) => routed.push(path));
		opener.editorProject("/work/shop", { name: "Shop" });

		expect(JSON.parse(textOf(await opener.open({ path: "/work/shop" }))).name).toBe("Shop");
		expect(routed).toEqual([]);

		opener.editorClosed("/work/shop");
		const pending = opener.open({ path: "/work/shop" });
		expect(routed).toEqual(["/work/shop"]);
		opener.editorProject("/work/shop", { name: "Shop" });
		await pending;
	});

	test("reports a folder that can't open, a bad path and a slow load", async () => {
		const opener = createAgentOpener(10);
		opener.handleOpen(() => {});

		const failing = opener.open({ path: "/missing" });
		opener.editorProject("/missing", { error: "Folder not found: /missing" });
		expect(await failing).toEqual({
			content: [{ type: "text", text: "Rabisco couldn't open /missing: Folder not found: /missing" }],
			isError: true,
		});

		expect(textOf(await opener.open({ path: "relative/folder" }))).toBe("`path` must be an absolute folder path.");
		expect(textOf(await opener.open({}))).toBe("`path` must be an absolute folder path.");
		expect(textOf(await opener.open({ path: "/slow" }))).toBe("Rabisco is still opening /slow. Try again.");
	});

	test("needs the app's router", async () => {
		const opener = createAgentOpener();
		const stop = opener.handleOpen(() => {});
		stop();

		expect((await opener.open({ path: "/work/shop" })).isError).toBe(true);
	});
});
