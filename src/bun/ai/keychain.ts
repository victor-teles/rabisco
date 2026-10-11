// Secrets go via stdin, never argv (visible in `ps`). `find-generic-password -w` prints non-ASCII
// secrets as hex, so secrets are limited to printable ASCII (every API key format is).

import type { KeyStorage } from "../../shared/ai/settings";

export const KEYCHAIN_SERVICE = "app.rabisco.desktop";

export interface SecretStore {
	get(account: string): Promise<string | null>;
	set(account: string, secret: string): Promise<void>;
	delete(account: string): Promise<void>;
	check(): Promise<KeyStorage>;
}

export const apiKeyAccount = (providerId: string) => `provider:${providerId}`;

export type RunCommand = (
	argv: string[],
	stdin?: string,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export const runCommand: RunCommand = async (argv, stdin) => {
	const proc = Bun.spawn(argv, { stdin: stdin === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });

	if (stdin !== undefined && proc.stdin) {
		proc.stdin.write(stdin);
		await proc.stdin.end();
	}

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	return { exitCode, stdout, stderr };
};

function assertSecret(secret: string) {
	if (!secret) throw new Error("The key is empty.");

	if (!/^[\x20-\x7e]+$/.test(secret))
		throw new Error("The key contains characters that aren't allowed. Paste it again without line breaks.");
}

function assertAccount(account: string) {
	if (!/^[\w.:@-]+$/.test(account)) throw new Error(`Invalid keychain account name: ${account}`);
}

const hex = (text: string) => Buffer.from(text, "utf-8").toString("hex");

/** `security` exit code when the item doesn't exist (errSecItemNotFound) */
const MAC_NOT_FOUND = 44;

export function createMacSecretStore(run: RunCommand = runCommand, service = KEYCHAIN_SERVICE): SecretStore {
	const fail = (action: string, result: { exitCode: number; stderr: string }) =>
		new Error(
			`Could not ${action} the keychain item (security exited with ${result.exitCode}): ${result.stderr.trim()}`,
		);

	return {
		async get(account) {
			assertAccount(account);
			const result = await run(["/usr/bin/security", "find-generic-password", "-s", service, "-a", account, "-w"]);

			if (result.exitCode === MAC_NOT_FOUND) return null;

			if (result.exitCode !== 0) throw fail("read", result);

			return result.stdout.replace(/\n$/, "") || null;
		},
		async set(account, secret) {
			assertAccount(account);
			assertSecret(secret);
			// Via stdin so the secret isn't in argv; -U updates an existing item
			const command = `add-generic-password -U -s "${service}" -a "${account}" -X ${hex(secret)}\n`;
			const result = await run(["/usr/bin/security", "-i"], command);

			if (result.exitCode !== 0) throw fail("save", result);
		},
		async delete(account) {
			assertAccount(account);
			const result = await run(["/usr/bin/security", "delete-generic-password", "-s", service, "-a", account]);

			if (result.exitCode !== 0 && result.exitCode !== MAC_NOT_FOUND) throw fail("delete", result);
		},
		check: async () => ({ ok: true, name: "the macOS Keychain" }),
	};
}

export function createLinuxSecretStore(run: RunCommand = runCommand, service = KEYCHAIN_SERVICE): SecretStore {
	const attrs = (account: string) => ["service", service, "account", account];
	const missing = (stderr: string) => /not found|No such file/i.test(stderr);

	const notInstalled =
		"secret-tool is not installed. Install libsecret-tools (or your distribution's equivalent) to store API keys.";

	const wrap = async (argv: string[], stdin?: string) => {
		try {
			return await run(argv, stdin);
		} catch {
			throw new Error(notInstalled);
		}
	};

	return {
		async get(account) {
			assertAccount(account);
			const result = await wrap(["secret-tool", "lookup", ...attrs(account)]);

			// `lookup` exits 1 with no output when nothing matches
			if (result.exitCode !== 0) {
				if (!result.stderr.trim() || missing(result.stderr)) return null;
				throw new Error(`Could not read the key: ${result.stderr.trim()}`);
			}

			return result.stdout.replace(/\n$/, "") || null;
		},
		async set(account, secret) {
			assertAccount(account);
			assertSecret(secret);
			const result = await wrap(["secret-tool", "store", `--label=Rabisco (${account})`, ...attrs(account)], secret);

			if (result.exitCode !== 0) throw new Error(`Could not save the key: ${result.stderr.trim()}`);
		},
		async delete(account) {
			assertAccount(account);
			const result = await wrap(["secret-tool", "clear", ...attrs(account)]);

			if (result.exitCode !== 0 && result.stderr.trim() && !missing(result.stderr)) {
				throw new Error(`Could not delete the key: ${result.stderr.trim()}`);
			}
		},
		async check() {
			try {
				await run(["secret-tool", "--version"]);

				return { ok: true, name: "your system keyring" };
			} catch {
				return { ok: false, message: notInstalled };
			}
		},
	};
}

const WIN_NOT_FOUND = 3;

const WIN_ELEMENT_NOT_FOUND = -2147023728;

const quotePs = (text: string) => `'${text.replace(/'/g, "''")}'`;

function windowsScript(body: string[]) {
	return [
		"$ErrorActionPreference = 'Stop'",
		"$ProgressPreference = 'SilentlyContinue'",
		"[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]",
		"$vault = New-Object Windows.Security.Credentials.PasswordVault",
		"function Find-Key($resource, $user) {",
		"\ttry { return $vault.Retrieve($resource, $user) } catch {",
		"\t\t$e = $_.Exception",
		"\t\twhile ($e.InnerException) { $e = $e.InnerException }",
		`\t\tif ($e.HResult -eq ${WIN_ELEMENT_NOT_FOUND}) { return $null }`,
		"\t\tthrow",
		"\t}",
		"}",
		...body,
	].join("\n");
}

export function createWindowsSecretStore(run: RunCommand = runCommand, service = KEYCHAIN_SERVICE): SecretStore {
	const powershell = (body: string[], stdin?: string) =>
		run(
			[
				"powershell.exe",
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-EncodedCommand",
				Buffer.from(windowsScript(body), "utf16le").toString("base64"),
			],
			stdin,
		);

	const find = (account: string) => `$found = Find-Key ${quotePs(service)} ${quotePs(account)}`;

	const fail = (action: string, result: { exitCode: number; stderr: string }) =>
		new Error(
			`Could not ${action} the key in Windows Credential Manager (PowerShell exited with ${result.exitCode}): ${result.stderr.trim()}`,
		);

	return {
		async get(account) {
			assertAccount(account);

			const result = await powershell([
				find(account),
				`if ($null -eq $found) { exit ${WIN_NOT_FOUND} }`,
				"$found.RetrievePassword()",
				"[Console]::Out.Write($found.Password)",
			]);

			if (result.exitCode === WIN_NOT_FOUND) return null;

			if (result.exitCode !== 0) throw fail("read", result);

			return result.stdout.replace(/\r?\n$/, "") || null;
		},
		async set(account, secret) {
			assertAccount(account);
			assertSecret(secret);

			const result = await powershell(
				[
					"$secret = [Console]::In.ReadToEnd()",
					find(account),
					"if ($null -ne $found) { $vault.Remove($found) }",
					`$vault.Add((New-Object Windows.Security.Credentials.PasswordCredential(${quotePs(service)}, ${quotePs(account)}, $secret)))`,
				],
				secret,
			);

			if (result.exitCode !== 0) throw fail("save", result);
		},
		async delete(account) {
			assertAccount(account);
			const result = await powershell([find(account), "if ($null -ne $found) { $vault.Remove($found) }"]);

			if (result.exitCode !== 0) throw fail("delete", result);
		},
		async check() {
			const unavailable = "Windows Credential Manager isn't available, so Rabisco can't store API keys.";

			try {
				const result = await powershell(["exit 0"]);

				if (result.exitCode === 0) return { ok: true, name: "Windows Credential Manager" };

				return { ok: false, message: `${unavailable} ${result.stderr.trim()}`.trim() };
			} catch {
				return { ok: false, message: `${unavailable} PowerShell could not start.` };
			}
		},
	};
}

export function createUnavailableSecretStore(message: string): SecretStore {
	return {
		get: async () => null,
		async set() {
			throw new Error(message);
		},
		delete: async () => {},
		check: async () => ({ ok: false, message }),
	};
}

export function createSecretStore(platform: NodeJS.Platform = process.platform): SecretStore {
	if (platform === "darwin") return createMacSecretStore();

	if (platform === "linux") return createLinuxSecretStore();

	if (platform === "win32") return createWindowsSecretStore();

	return createUnavailableSecretStore(
		`Rabisco can't store API keys on ${platform}. Use a CLI provider or a local model, which need no key.`,
	);
}

export function createMemorySecretStore(
	initial: Record<string, string> = {},
): SecretStore & { entries(): Record<string, string> } {
	const map = new Map(Object.entries(initial));

	return {
		async get(account) {
			return map.get(account) ?? null;
		},
		async set(account, secret) {
			assertSecret(secret);
			map.set(account, secret);
		},
		async delete(account) {
			map.delete(account);
		},
		check: async () => ({ ok: true, name: "memory" }),
		entries: () => Object.fromEntries(map),
	};
}
