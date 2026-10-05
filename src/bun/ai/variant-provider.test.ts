import { describe, expect, test } from "bun:test";
import type { GenerationEvent, GenerationRequest, Provider } from "../../shared/ai/contract";
import { createVariantRenamer } from "../../shared/ai/variants";
import { runGeneration } from "./run";
import { validateFiles } from "./validate";
import { variantProvider } from "./variant-provider";

const SCREEN = `import { Row } from "../components/row";\nexport default function A() { return <Row /> }\n`;
const ROW = `export function Row() { return <div /> }\n`;
const BAD = `export default function A() { return <div> }\n`;

function scripted(scripts: GenerationEvent[][]) {
	const requests: GenerationRequest[] = [];
	const provider: Provider = {
		id: "fake",
		kind: "api",
		label: "Fake",
		capabilities: { streaming: true, images: false, agentic: false, maxContextTokens: 1000 },
		health: async () => ({ ok: true }),
		listModels: async () => [],
		async *generate(request) {
			const script = scripts[requests.length];
			requests.push(request);
			if (!script) throw new Error("unexpected call");
			yield* script;
		},
	};
	return { provider, requests };
}

const file = (path: string, content: string): GenerationEvent[] => [
	{ type: "file.start", path, kind: path.startsWith("screens/") ? "screen" : "component" },
	{ type: "file.end", path, content },
];

const request: GenerationRequest = { id: "g1-v1", task: "create", model: "m", prompt: "a screen", device: "mobile", context: {}, files: [] };

describe("variantProvider", () => {
	test("keeps the provider's identity and renames its stream", async () => {
		const { provider } = scripted([[...file("screens/a.tsx", SCREEN), ...file("components/row.tsx", ROW), { type: "done" }]]);
		const wrapped = variantProvider(provider, createVariantRenamer({ variant: 1, taken: ["screens/a.tsx"] }));
		expect([wrapped.id, wrapped.kind, wrapped.label]).toEqual(["fake", "api", "Fake"]);
		const paths: string[] = [];
		for await (const event of wrapped.generate(request, new AbortController().signal)) if (event.type === "file.end") paths.push(event.path);
		expect(paths).toEqual(["screens/a.alt-1.tsx", "screens/a.alt-1.tsx", "components/row-v2.tsx"]);
	});

	test("validation and repairs see the assigned names", async () => {
		const { provider, requests } = scripted([
			[...file("screens/a.tsx", BAD), ...file("components/row.tsx", ROW), { type: "done" }],
			[...file("screens/a.alt-1.tsx", SCREEN.replace("row", "row-v2")), { type: "done" }],
		]);
		const renamer = createVariantRenamer({ variant: 1, taken: ["screens/a.tsx"] });
		const result = await runGeneration({
			provider: variantProvider(provider, renamer),
			request,
			projectFiles: { "screens/a.tsx": SCREEN },
			signal: new AbortController().signal,
			alternates: renamer.assigned,
			onEvent: () => {},
		});
		expect(requests[1]!.targets).toEqual(["screens/a.alt-1.tsx"]);
		expect(result.problems).toEqual([]);
		expect(result.changes).toEqual([
			{ path: "screens/a.alt-1.tsx", content: SCREEN.replace("row", "row-v2") },
			{ path: "components/row-v2.tsx", content: ROW },
		]);
	});

	test("plain runs still reject alternates; assigned ones pass", () => {
		const written = [{ path: "screens/a.alt-1.tsx", content: `export default function A() { return <p /> }` }];
		expect(validateFiles(written, {})[0]!.message).toContain("Alternates are named by Rabisco");
		expect(validateFiles(written, {}, [], { alternates: new Set(["screens/a.alt-1.tsx"]) })).toEqual([]);
		expect(validateFiles(written, {}, [], { alternates: new Set(["screens/a.alt-2.tsx"]) })).toHaveLength(1);
	});
});
