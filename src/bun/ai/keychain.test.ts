import { describe, expect, test } from "bun:test";
import {
	createLinuxSecretStore,
	createMacSecretStore,
	createMemorySecretStore,
	createSecretStore,
	type RunCommand,
} from "./keychain";

function recorder(reply: (argv: string[]) => { exitCode: number; stdout?: string; stderr?: string }) {
	const calls: { argv: string[]; stdin?: string }[] = [];

	const run: RunCommand = async (argv, stdin) => {
		calls.push({ argv, stdin });
		const r = reply(argv);

		return { exitCode: r.exitCode, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
	};

	return { calls, run };
}

describe("macOS secret store", () => {
	test("set passes the secret through stdin, never argv", async () => {
		const { calls, run } = recorder(() => ({ exitCode: 0 }));
		await createMacSecretStore(run).set("provider:anthropic", 'sk "x"');
		expect(calls).toHaveLength(1);
		expect(calls[0]!.argv).toEqual(["/usr/bin/security", "-i"]);
		expect(calls[0]!.argv.join(" ")).not.toContain("sk");
		expect(calls[0]!.stdin).toBe(
			`add-generic-password -U -s "app.rabisco.desktop" -a "provider:anthropic" -X ${Buffer.from('sk "x"').toString("hex")}\n`,
		);
	});

	test("get returns null when the item is missing", async () => {
		const { run } = recorder(() => ({ exitCode: 44, stderr: "could not be found" }));
		expect(await createMacSecretStore(run).get("provider:x")).toBeNull();
		await createMacSecretStore(run).delete("provider:x");
	});

	test("rejects secrets with line breaks and odd account names", async () => {
		const { run } = recorder(() => ({ exitCode: 0 }));
		await expect(createMacSecretStore(run).set("provider:x", "a\nb")).rejects.toThrow("line breaks");
		await expect(createMacSecretStore(run).get('x" -w')).rejects.toThrow("Invalid keychain account");
	});

	test.skipIf(process.platform !== "darwin")("round-trips through the real keychain", async () => {
		const store = createMacSecretStore(undefined, "app.rabisco.test");
		const account = `test:${crypto.randomUUID()}`;

		try {
			expect(await store.get(account)).toBeNull();
			await store.set(account, `sk-ant "quoted' \\ $HOME`);
			expect(await store.get(account)).toBe(`sk-ant "quoted' \\ $HOME`);
			await store.set(account, "updated");
			expect(await store.get(account)).toBe("updated");
		} finally {
			await store.delete(account);
		}

		expect(await store.get(account)).toBeNull();
	});
});

describe("Linux secret store", () => {
	test("store reads the secret from stdin; lookup misses return null", async () => {
		const { calls, run } = recorder((argv) => ({ exitCode: argv[1] === "lookup" ? 1 : 0 }));
		const store = createLinuxSecretStore(run);
		await store.set("provider:openai", "sk-1");
		expect(calls[0]).toEqual({
			argv: [
				"secret-tool",
				"store",
				"--label=Rabisco (provider:openai)",
				"service",
				"app.rabisco.desktop",
				"account",
				"provider:openai",
			],
			stdin: "sk-1",
		});
		expect(await store.get("provider:openai")).toBeNull();
	});

	test("a missing secret-tool gives a clear error", async () => {
		const store = createLinuxSecretStore(async () => {
			throw new Error("ENOENT");
		});

		await expect(store.get("provider:x")).rejects.toThrow("secret-tool is not installed");
	});
});

test("unsupported platforms throw", () => {
	expect(() => createSecretStore("win32")).toThrow("isn't supported on win32");
});

test("memory store", async () => {
	const store = createMemorySecretStore({ a: "1" });
	expect(await store.get("a")).toBe("1");
	await store.set("b", "2");
	await store.delete("a");
	expect(store.entries()).toEqual({ b: "2" });
});
