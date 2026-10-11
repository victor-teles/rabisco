import { describe, expect, test } from "bun:test";
import {
	createLinuxSecretStore,
	createMacSecretStore,
	createMemorySecretStore,
	createSecretStore,
	createWindowsSecretStore,
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

const decodeScript = (argv: string[]) => Buffer.from(argv.at(-1) ?? "", "base64").toString("utf16le");

describe("Windows secret store", () => {
	test("set passes the secret through stdin and the script carries only names", async () => {
		const { calls, run } = recorder(() => ({ exitCode: 0 }));
		await createWindowsSecretStore(run).set("provider:anthropic", "sk-ant-secret");
		expect(calls).toHaveLength(1);
		expect(calls[0]!.argv.slice(0, -1)).toEqual([
			"powershell.exe",
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-EncodedCommand",
		]);
		expect(calls[0]!.stdin).toBe("sk-ant-secret");

		const script = decodeScript(calls[0]!.argv);
		expect(script).not.toContain("sk-ant-secret");
		expect(script).toContain("[Console]::In.ReadToEnd()");
		expect(script).toContain("PasswordCredential('app.rabisco.desktop', 'provider:anthropic', $secret)");
	});

	test("get reads stdout; a missing item is null", async () => {
		const found = recorder(() => ({ exitCode: 0, stdout: "sk-1\r\n" }));
		expect(await createWindowsSecretStore(found.run).get("provider:openai")).toBe("sk-1");
		expect(decodeScript(found.calls[0]!.argv)).toContain("Find-Key 'app.rabisco.desktop' 'provider:openai'");

		const missing = recorder(() => ({ exitCode: 3 }));
		expect(await createWindowsSecretStore(missing.run).get("provider:openai")).toBeNull();
	});

	test("failures name Credential Manager; a missing item deletes quietly", async () => {
		const { run } = recorder(() => ({ exitCode: 1, stderr: "Access denied" }));
		await expect(createWindowsSecretStore(run).set("provider:x", "k")).rejects.toThrow("Windows Credential Manager");
		await expect(createWindowsSecretStore(run).get('x" ; rm')).rejects.toThrow("Invalid keychain account");

		const ok = recorder(() => ({ exitCode: 0 }));
		await createWindowsSecretStore(ok.run).delete("provider:x");
		expect(decodeScript(ok.calls[0]!.argv)).toContain("if ($null -ne $found) { $vault.Remove($found) }");
	});

	test("check reports whether PowerShell can reach the vault", async () => {
		const ok = recorder(() => ({ exitCode: 0 }));
		expect(await createWindowsSecretStore(ok.run).check()).toEqual({ ok: true, name: "Windows Credential Manager" });

		const broken = createWindowsSecretStore(async () => {
			throw new Error("ENOENT");
		});

		expect(await broken.check()).toMatchObject({ ok: false });
	});
});

describe("platforms", () => {
	test("win32 gets Credential Manager", async () => {
		expect(createSecretStore("win32")).toHaveProperty("check");
	});

	test("other platforms can't store keys and say so", async () => {
		const store = createSecretStore("freebsd");
		expect(await store.get("provider:x")).toBeNull();
		await expect(store.set("provider:x", "k")).rejects.toThrow("can't store API keys on freebsd");
		expect(await store.check()).toMatchObject({ ok: false, message: expect.stringContaining("freebsd") });
	});

	test("Linux without secret-tool says so", async () => {
		const store = createLinuxSecretStore(async () => {
			throw new Error("ENOENT");
		});

		expect(await store.check()).toMatchObject({ ok: false, message: expect.stringContaining("secret-tool") });
	});
});

test("memory store", async () => {
	const store = createMemorySecretStore({ a: "1" });
	expect(await store.get("a")).toBe("1");
	await store.set("b", "2");
	await store.delete("a");
	expect(store.entries()).toEqual({ b: "2" });
});
