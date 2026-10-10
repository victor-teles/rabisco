import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tempDir } from "../test-utils";
import { apiKeyAccount, createMemorySecretStore } from "./keychain";
import { SETTINGS_FILE, createSettingsStore, normalizeSettings, uniqueProviderId } from "./settings-store";

function setup(detected: Record<string, boolean> = {}) {
	const dir = tempDir();
	const secrets = createMemorySecretStore();
	const store = createSettingsStore({ userDataDir: dir, secrets, detect: async () => detected });

	return { dir, secrets, store, file: join(dir, SETTINGS_FILE) };
}

describe("settings store", () => {
	test("seeds detected CLI providers when the file is missing, and saves them", async () => {
		const { store, file } = setup({ claude: true, ollama: true });
		const settings = await store.get();
		expect(settings.providers.map((p) => [p.id, p.type, p.enabled])).toEqual([
			["claude-code", "claude-code", true],
			["ollama", "ollama", true],
		]);
		expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual(settings);
	});

	test("seeds nothing when nothing is detected, and doesn't seed again", async () => {
		const { store, dir, secrets } = setup();
		expect((await store.get()).providers).toEqual([]);
		const again = createSettingsStore({ userDataDir: dir, secrets, detect: async () => ({ claude: true }) });
		expect(await again.list()).toEqual([]);
	});

	test("malformed file falls back to defaults", async () => {
		const { store, file } = setup({ claude: true });
		writeFileSync(file, "{ nope");
		expect(await store.get()).toEqual({ version: 1, providers: [] });
	});

	test("normalize drops invalid entries and duplicates", () => {
		const settings = normalizeSettings({
			providers: [
				{ id: "anthropic", type: "anthropic", label: "", enabled: true, hasKey: true, baseUrl: " " },
				{ id: "anthropic", type: "anthropic" },
				{ id: "x", type: "nope" },
				{ id: "Bad Id", type: "openai" },
				null,
			],
			defaultModel: "anthropic:claude",
		});

		expect(settings).toEqual({
			version: 1,
			providers: [{ id: "anthropic", type: "anthropic", label: "Anthropic", enabled: true, hasKey: true }],
			defaultModel: "anthropic:claude",
		});
	});

	test("add gives unique ids from the type", async () => {
		const { store } = setup();
		expect((await store.add({ type: "anthropic" })).id).toBe("anthropic");
		expect((await store.add({ type: "anthropic", label: "Work" })).id).toBe("anthropic-2");
		expect((await store.list()).map((p) => p.label)).toEqual(["Anthropic", "Work"]);
		expect(uniqueProviderId("openai", ["openai", "openai-2"])).toBe("openai-3");
	});

	test("openai-compatible needs a base URL", async () => {
		const { store } = setup();
		await expect(store.add({ type: "openai-compatible" })).rejects.toThrow("base URL");
		const config = await store.add({ type: "openai-compatible", baseUrl: "http://localhost:1234/v1" });
		await expect(store.update(config.id, { baseUrl: "" })).rejects.toThrow("base URL");
		expect((await store.list())[0]!.baseUrl).toBe("http://localhost:1234/v1");
	});

	test("update patches fields and clears empty ones", async () => {
		const { store } = setup();
		const { id } = await store.add({ type: "ollama", defaultModel: "qwen3" });
		const updated = await store.update(id, { enabled: false, label: "Local", defaultModel: "" });
		expect(updated).toEqual({ id, type: "ollama", label: "Local", enabled: false });
		await expect(store.update("nope", {})).rejects.toThrow('No provider with id "nope"');
	});

	test("api keys go to the secret store, with a hasKey flag", async () => {
		const { store, secrets, file } = setup();
		const { id } = await store.add({ type: "anthropic" });
		await store.setApiKey(id, "  sk-ant-123 ");
		expect(secrets.entries()).toEqual({ [apiKeyAccount(id)]: "sk-ant-123" });
		expect(await store.getApiKey(id)).toBe("sk-ant-123");
		expect((await store.list())[0]!.hasKey).toBe(true);
		expect(readFileSync(file, "utf-8")).not.toContain("sk-ant");
		await store.clearApiKey(id);
		expect(secrets.entries()).toEqual({});
		expect((await store.list())[0]!.hasKey).toBeUndefined();
	});

	test("remove deletes the provider, its key and a default model pointing to it", async () => {
		const { store, secrets } = setup();
		const { id } = await store.add({ type: "anthropic" });
		await store.setApiKey(id, "sk");
		await store.setDefaultModel(`${id}:claude`);
		await store.remove(id);
		expect(await store.get()).toEqual({ version: 1, providers: [] });
		expect(secrets.entries()).toEqual({});
	});

	test("default model", async () => {
		const { store } = setup();
		await expect(store.setDefaultModel("nocolon")).rejects.toThrow("Invalid model");
		await store.setDefaultModel("ollama:qwen3-coder:30b");
		expect((await store.get()).defaultModel).toBe("ollama:qwen3-coder:30b");
		await store.setDefaultModel(null);
		expect((await store.get()).defaultModel).toBeUndefined();
	});

	test("concurrent adds don't lose writes", async () => {
		const { store, file } = setup();
		await Promise.all([store.add({ type: "openai" }), store.add({ type: "openai" }), store.add({ type: "openai" })]);
		expect((await store.list()).map((p) => p.id)).toEqual(["openai", "openai-2", "openai-3"]);
		expect(existsSync(`${file}.tmp`)).toBe(false);
	});
});
