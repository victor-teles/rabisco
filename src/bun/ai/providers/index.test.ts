import { describe, expect, test } from "bun:test";
import type { Provider } from "../../../shared/ai/contract";
import type { ProviderConfig } from "../../../shared/ai/settings";
import { createMemorySecretStore } from "../keychain";
import { ProviderRegistry, createProvider } from "./index";

const secrets = createMemorySecretStore();

function fake(config: ProviderConfig, overrides: Partial<Provider> = {}): Provider {
	return {
		id: config.id,
		kind: "api",
		label: config.label,
		capabilities: { streaming: true, images: false, agentic: false, maxContextTokens: 1000 },
		health: async () => ({ ok: true }),
		listModels: async () => [{ id: "m1", label: "M1" }],
		generate: async function* () {},
		...overrides,
	};
}

const configs: ProviderConfig[] = [
	{ id: "anthropic", type: "anthropic", label: "Anthropic", enabled: true, defaultModel: "claude" },
	{ id: "ollama", type: "ollama", label: "Ollama", enabled: true },
	{ id: "openai", type: "openai", label: "OpenAI", enabled: false },
];

describe("ProviderRegistry", () => {
	test("caches instances until the config changes", () => {
		let created = 0;
		const registry = new ProviderRegistry({ secrets, create: (c) => (created++, fake(c)) }, configs);
		const a = registry.get("anthropic");
		expect(registry.get("anthropic")).toBe(a);
		registry.setConfigs([{ ...configs[0]!, label: "Changed" }]);
		expect(registry.get("anthropic")).not.toBe(a);
		expect(registry.get("ollama")).toBeNull();
		expect(created).toBe(2);
	});

	test("resolves model refs", () => {
		const registry = new ProviderRegistry({ secrets, create: (c) => fake(c) }, configs);
		expect(registry.resolve("ollama:qwen3-coder:30b")).toMatchObject({
			model: "qwen3-coder:30b",
			config: { id: "ollama" },
		});
		expect(registry.resolve("anthropic")).toMatchObject({ model: "claude" });
		expect(registry.resolve("ollama")).toBeNull();
		expect(registry.resolve("openai:gpt")).toBeNull();
		expect(registry.resolve("nope:x")).toBeNull();
	});

	test("includes the mock only when asked", () => {
		expect(new ProviderRegistry({ secrets }, configs).resolve("mock:mock")).toBeNull();
		const resolved = new ProviderRegistry({ secrets, includeMock: true }, configs).resolve("mock:mock");
		expect(resolved?.provider.label).toBe("Mock (dev)");
		expect(resolved?.model).toBe("mock");
	});

	test("statuses never throw, time out slow providers and skip disabled ones", async () => {
		const registry = new ProviderRegistry(
			{
				secrets,
				statusTimeoutMs: 20,
				create: (c) =>
					c.id === "anthropic"
						? fake(c, {
								health: async () => ({ ok: false, code: "not_authenticated", message: "No key" }),
								listModels: () => Promise.reject(new Error("401")),
							})
						: fake(c, { health: () => new Promise(() => {}) }),
			},
			configs,
		);

		const statuses = await registry.statuses();
		expect(statuses.map((s) => [s.id, s.health && s.health.ok, s.models.length])).toEqual([
			["anthropic", false, 0],
			["ollama", false, 1],
			["openai", null, 0],
		]);
		expect(statuses[1]!.health).toMatchObject({ code: "network" });
		expect(statuses[2]).toMatchObject({ enabled: false, kind: "api", health: null });
	});

	test("createProvider builds the right kind for each type", () => {
		const make = (type: ProviderConfig["type"], extra: Partial<ProviderConfig> = {}) =>
			createProvider({ id: type, type, label: type, enabled: true, ...extra }, { secrets });

		expect(make("anthropic").kind).toBe("api");
		expect(make("openai-compatible", { baseUrl: "http://localhost:1234/v1" }).kind).toBe("api");
		expect(make("claude-code").kind).toBe("cli");
		expect(make("codex").kind).toBe("cli");
		expect(make("gemini-cli").kind).toBe("cli");
		expect(make("claude-agent-sdk").kind).toBe("sdk");
		expect(make("mock").id).toBe("mock");
	});
});
