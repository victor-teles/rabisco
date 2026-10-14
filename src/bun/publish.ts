// Decision 0038. Rabisco runs no server: the files go to a host the user owns, with their token.
import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { isBoolean, isNumber, isString } from "../shared/guards";
import type { Json } from "../shared/json";
import {
	assertPassword,
	isPublishHost,
	PUBLISH_HOST_INFO,
	PUBLISH_HOSTS,
	publishTokenAccount,
	sealText,
	type PublishHost,
	type PublishHostStatus,
	type PublishParams,
	type PublishTarget,
} from "../shared/share/publish";
import { assertSnapshot, type ScreenRuntime } from "../shared/share/snapshot";
import { viewerFiles } from "../shared/share/viewer";
import type { SecretStore } from "./ai/keychain";
import { objectOr, optionalString, parseJson } from "./json";
import type { HostClient, PublishFile } from "./publish-hosts";
import { projectKey } from "./saved-history";

export const PUBLISH_DIR = "publish";

export type PublishServiceOptions = {
	userDataDir: string;
	secrets: SecretStore;
	hosts: Record<PublishHost, HostClient>;
	readRuntime: () => ScreenRuntime;
	now?: () => Date;
	/** Lower in tests: 600,000 rounds take a moment */
	sealRounds?: number;
};

const targetFile = (userDataDir: string, dir: string) => join(userDataDir, PUBLISH_DIR, `${projectKey(dir)}.json`);

function parseTarget(value: Json): PublishTarget | null {
	const raw = objectOr(value);
	const { host, siteId, siteName, url, publishedAt, digest, screens, locked } = raw;

	if (
		!isString(host) ||
		!isPublishHost(host) ||
		!isString(siteId) ||
		!isString(siteName) ||
		!isString(url) ||
		!url.startsWith("https://") ||
		!isString(publishedAt) ||
		!isString(digest) ||
		!isNumber(screens) ||
		!isBoolean(locked)
	)
		return null;

	const target: PublishTarget = { host, siteId, siteName, url, publishedAt, digest, screens, locked };
	const expiresAt = optionalString(raw.expiresAt);

	if (expiresAt) target.expiresAt = expiresAt;

	return target;
}

function readTarget(file: string) {
	try {
		return parseTarget(parseJson(readFileSync(file, "utf8")));
	} catch {
		return null;
	}
}

const encoder = new TextEncoder();

function assertHost(host: string): asserts host is PublishHost {
	if (!isPublishHost(host)) throw new Error(`Rabisco can't publish to ${host}.`);
}

export function createPublishService(options: PublishServiceOptions) {
	const now = options.now ?? (() => new Date());
	const dir = join(options.userDataDir, PUBLISH_DIR);

	const writeTarget = (path: string, target: PublishTarget) => {
		mkdirSync(dir, { recursive: true });
		writeFileSync(targetFile(options.userDataDir, path), `${JSON.stringify({ path, ...target }, null, "\t")}\n`);
	};

	const token = async (host: PublishHost) => {
		const value = await options.secrets.get(publishTokenAccount(host));

		if (!value) throw new Error(`Connect ${PUBLISH_HOST_INFO[host].name} first.`);

		return value;
	};

	async function hosts(): Promise<PublishHostStatus[]> {
		const result: PublishHostStatus[] = [];

		for (const host of PUBLISH_HOSTS)
			result.push({ host, connected: !!(await options.secrets.get(publishTokenAccount(host))) });

		return result;
	}

	function expired(target: PublishTarget) {
		return !!target.expiresAt && Date.parse(target.expiresAt) <= now().getTime();
	}

	async function takeDown(file: string, target: PublishTarget) {
		const secret = await options.secrets.get(publishTokenAccount(target.host));

		// Without the token the site stays up; the next sweep tries again
		if (!secret) return false;
		await options.hosts[target.host].remove(secret, target.siteId);
		rmSync(file, { force: true });

		return true;
	}

	function target(path: string) {
		return readTarget(targetFile(options.userDataDir, path));
	}

	return {
		hosts,

		/** Checks the token with one read-only call before it goes in the keychain */
		async connect(host: PublishHost, secret: string) {
			assertHost(host);
			const trimmed = secret.trim();

			if (!trimmed) throw new Error("Paste a token first.");
			await options.hosts[host].verify(trimmed);
			await options.secrets.set(publishTokenAccount(host), trimmed);

			return hosts();
		},

		/** Published sites stay up */
		async disconnect(host: PublishHost) {
			assertHost(host);
			await options.secrets.delete(publishTokenAccount(host));

			return hosts();
		},

		target,

		async publish(params: PublishParams, rawSnapshot: Json): Promise<PublishTarget> {
			assertHost(params.host);
			const snapshot = assertSnapshot(rawSnapshot);
			const existing = target(params.path);

			if (existing && existing.host !== params.host)
				throw new Error("This project is published on another host. Unpublish it there first.");

			if (params.expiresAt !== undefined && !(Date.parse(params.expiresAt) > now().getTime()))
				throw new Error("Pick an expiry date in the future.");

			if (params.password !== undefined) assertPassword(params.password);
			const text = JSON.stringify(snapshot);

			const sealed =
				params.password === undefined ? undefined : await sealText(text, params.password, options.sealRounds);

			const files: PublishFile[] = viewerFiles(snapshot, options.readRuntime(), {
				sealed,
				expiresAt: params.expiresAt,
				noindex: true,
			}).map((file) => ({ path: file.path, body: encoder.encode(file.content) }));

			const site = await options.hosts[params.host].deploy({
				token: await token(params.host),
				files,
				site: existing,
				// A sealed site must not show the project name, and a public one can get a password later
				newName: `design-${randomBytes(5).toString("hex")}`,
			});

			const published: PublishTarget = {
				host: params.host,
				...site,
				publishedAt: now().toISOString(),
				digest: createHash("sha256").update(text).digest("hex"),
				screens: snapshot.screens.length,
				locked: sealed !== undefined,
			};

			if (params.expiresAt) published.expiresAt = params.expiresAt;
			writeTarget(params.path, published);

			return published;
		},

		/** Deletes the site on the host and forgets it */
		async unpublish(path: string) {
			const file = targetFile(options.userDataDir, path);
			const target = readTarget(file);

			if (!target) return;

			if (!(await takeDown(file, target)))
				throw new Error("Connect the host again to remove the site. Rabisco needs the token to delete it.");
		},

		/** Takes down every site past its expiry; returns the URLs it removed */
		async sweep(): Promise<string[]> {
			if (!existsSync(dir)) return [];
			const removed: string[] = [];

			for (const name of readdirSync(dir)) {
				if (!name.endsWith(".json")) continue;
				const file = join(dir, name);
				const target = readTarget(file);

				if (!target || !expired(target)) continue;

				try {
					if (await takeDown(file, target)) removed.push(target.url);
				} catch (error) {
					console.warn(`Could not take down the expired site ${target.url}:`, error);
				}
			}

			return removed;
		},
	};
}

export type PublishService = ReturnType<typeof createPublishService>;
