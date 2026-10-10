// Secrets go via stdin, never argv (visible in `ps`). `find-generic-password -w` prints non-ASCII
// secrets as hex, so secrets are limited to printable ASCII (every API key format is).

export const KEYCHAIN_SERVICE = "app.rabisco.desktop";

export interface SecretStore {
	get(account: string): Promise<string | null>;
	set(account: string, secret: string): Promise<void>;
	delete(account: string): Promise<void>;
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
	};
}

export function createLinuxSecretStore(run: RunCommand = runCommand, service = KEYCHAIN_SERVICE): SecretStore {
	const attrs = (account: string) => ["service", service, "account", account];
	const missing = (stderr: string) => /not found|No such file/i.test(stderr);

	const wrap = async (argv: string[], stdin?: string) => {
		try {
			return await run(argv, stdin);
		} catch {
			throw new Error(
				"secret-tool is not installed. Install libsecret-tools (or your distribution's equivalent) to store API keys.",
			);
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
	};
}

/** Throws on platforms without a keychain. */
export function createSecretStore(platform: NodeJS.Platform = process.platform): SecretStore {
	if (platform === "darwin") return createMacSecretStore();

	if (platform === "linux") return createLinuxSecretStore();
	throw new Error(
		`Storing API keys isn't supported on ${platform} yet. Rabisco supports the macOS Keychain and libsecret on Linux.`,
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
		entries: () => Object.fromEntries(map),
	};
}
