import { describe, expect, test } from "bun:test";
import { applyEditBlocks, parseEditBlocks } from "./edit-blocks";

const HOME = `export default function Home() {
	return (
		<main>
			<h1 className="text-2xl">Orders</h1>
			<p>Recent orders</p>
		</main>
	);
}
`;

const block = (search: string, replace: string) => `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;

describe("parseEditBlocks", () => {
	test("reads several blocks and ignores text around them", () => {
		const body = `\n\`\`\`tsx\n${block("a", "b")}\n${block("c\nd", "")}\n\`\`\`\n`;

		expect(parseEditBlocks(body)).toEqual([
			{ search: "a", replace: "b" },
			{ search: "c\nd", replace: "" },
		]);
	});

	test("an unfinished block or no block is null", () => {
		expect(parseEditBlocks("<<<<<<< SEARCH\na\n=======\nb\n")).toBeNull();
		expect(parseEditBlocks("just text")).toBeNull();
	});
});

describe("applyEditBlocks", () => {
	test("exact match", () => {
		const result = applyEditBlocks(HOME, [
			{ search: '\t\t\t<h1 className="text-2xl">Orders</h1>', replace: '\t\t\t<h1 className="text-3xl">Orders</h1>' },
			{ search: "<p>Recent orders</p>", replace: "<p>Last 30 days</p>" },
		]);

		expect(result).toEqual({
			ok: true,
			content: HOME.replace("text-2xl", "text-3xl").replace("Recent orders", "Last 30 days"),
		});
	});

	test("tolerates indentation and trailing spaces, and re-indents the replacement", () => {
		const result = applyEditBlocks(HOME, [
			{
				search: '<h1 className="text-2xl">Orders</h1>  \n  <p>Recent orders</p>',
				replace: '<h1 className="text-3xl">Orders</h1>\n<p>Last 30 days</p>',
			},
		]);

		expect(result).toEqual({
			ok: true,
			content: HOME.replace("text-2xl", "text-3xl").replace("Recent orders", "Last 30 days"),
		});
	});

	test("a search that matches twice fails", () => {
		const result = applyEditBlocks(`${HOME}${HOME}`, [{ search: "<p>Recent orders</p>", replace: "x" }]);

		expect(result).toEqual({ ok: false, reason: "SEARCH block 1 matches 2 places" });
	});

	test("a missing search fails, even after an earlier block applied", () => {
		const result = applyEditBlocks(HOME, [
			{ search: "Orders", replace: "Sales" },
			{ search: "<h2>Nope</h2>", replace: "x" },
		]);

		expect(result).toEqual({ ok: false, reason: "SEARCH block 2 doesn't match the file" });
	});

	test("an empty search fails", () => {
		expect(applyEditBlocks(HOME, [{ search: "  ", replace: "x" }])).toMatchObject({ ok: false });
	});

	test("$ patterns in the replacement are literal", () => {
		expect(applyEditBlocks("a\n", [{ search: "a", replace: "$&$1" }])).toEqual({ ok: true, content: "$&$1\n" });
	});
});
