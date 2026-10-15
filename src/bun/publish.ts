// Decision 0038. Rabisco runs no server: the files go to a host the user owns, with their token.
import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { isBoolean, isNumber, isString } from "../shared/guards";
import type { Json } from "../shared/json";
import {
	assertPassword,
	DEFAULT_PAGES_BRANCH,
	isPublishHost,
	isTokenHost,
	PUBLISH_HOST_INFO,
	publishTokenAccount,
	sealText,
	TOKEN_HOSTS,
	type PublishHost,
	type PublishHostStatus,
	type PublishParams,
	type PublishTarget,
	type TokenHost,
} from "../shared/share/publish";
import { assertSnapshot, type ScreenRuntime } from "../shared/share/snapshot";
import { viewerFiles } from "../shared/share/viewer";
import type { SecretStore } from "./ai/keychain";
import { objectOr, optionalString, parseJson } from "./json";
import type { HostClient, PublishFile } from "./publish-hosts";
import { noticeFiles, type PagesClient } from "./publish-pages";
import { projectKey } from "./saved-history";

export const PUBLISH_DIR = "publish";

export type PublishServiceOptions = {
	userDataDir: string;
	secrets: SecretStore;
	hosts: Record<TokenHost, HostClient>;
	pages: PagesClient;
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

/** The project folder is kept next to the target, so the expiry sweep can reach a GitHub Pages branch */
function readEntry(file: string): { path: string | null; target: PublishTarget } | null {
	try {
		const raw = parseJson(readFileSync(file, "utf8"));
		const target = parseTarget(raw);

		return target && { path: optionalString(objectOr(raw).path) ?? null, target };
	} catch {
		return null;
	}
}

const readTarget = (file: string) => readEntry(file)?.target ?? null;

const encoder = new TextEncoder();

function assertHost(host: string): asserts host is PublishHost {
	if (!isPublishHost(host)) throw new Error(`Rabisco can't publish to ${host}.`);
}

function assertTokenHost(host: string): asserts host is TokenHost {
	if (!isTokenHost(host))
		throw new Error(`${isPublishHost(host) ? PUBLISH_HOST_INFO[host].name : host} doesn't use a token.`);
}

const NOTICES = {
	removed: ["This site was removed", "Ask the person who sent the link for a new one."],
	expired: ["This link has expired", "Ask the person who sent it for a new one."],
} as const;

type Notice = keyof typeof NOTICES;

const screensLabel = (count: number) => `${count} ${count === 1 ? "screen" : "screens"}`;

export function createPublishService(options: PublishServiceOptions) {
	const now = options.now ?? (() => new Date());
	const dir = join(options.userDataDir, PUBLISH_DIR);

	const writeTarget = (path: string, target: PublishTarget) => {
		mkdirSync(dir, { recursive: true });
		writeFileSync(targetFile(options.userDataDir, path), `${JSON.stringify({ path, ...target }, null, "\t")}\n`);
	};

	const token = async (host: TokenHost) => {
		const value = await options.secrets.get(publishTokenAccount(host));

		if (!value) throw new Error(`Connect ${PUBLISH_HOST_INFO[host].name} first.`);

		return value;
	};

	async function hosts(): Promise<PublishHostStatus[]> {
		const result: PublishHostStatus[] = [];

		for (const host of TOKEN_HOSTS)
			result.push({ host, connected: !!(await options.secrets.get(publishTokenAccount(host))) });

		return result;
	}

	function expired(target: PublishTarget) {
		return !!target.expiresAt && Date.parse(target.expiresAt) <= now().getTime();
	}

	async function takeDown(file: string, path: string | null, target: PublishTarget, notice: Notice) {
		if (target.host === "github") {
			// A moved or deleted project folder leaves the site up; the next sweep tries again
			if (!path) return false;
			const [title, text] = NOTICES[notice];

			await options.pages.deploy({
				dir: path,
				branch: target.siteId,
				files: noticeFiles(title, text),
				message: `Rabisco: ${notice === "expired" ? "take down the expired site" : "remove the site"}`,
			});
		} else {
			const secret = await options.secrets.get(publishTokenAccount(target.host));

			// Without the token the site stays up; the next sweep tries again
			if (!secret) return false;
			await options.hosts[target.host].remove(secret, target.siteId);
		}

		rmSync(file, { force: true });

		return true;
	}

	function target(path: string) {
		return readTarget(targetFile(options.userDataDir, path));
	}

	return {
		hosts,

		/** Checks the token with one read-only call before it goes in the keychain */
		async connect(host: TokenHost, secret: string) {
			assertTokenHost(host);
			const trimmed = secret.trim();

			if (!trimmed) throw new Error("Paste a token first.");
			await options.hosts[host].verify(trimmed);
			await options.secrets.set(publishTokenAccount(host), trimmed);

			return hosts();
		},

		/** Published sites stay up */
		async disconnect(host: TokenHost) {
			assertTokenHost(host);
			await options.secrets.delete(publishTokenAccount(host));

			return hosts();
		},

		target,

		pages: (path: string) => options.pages.status(path),

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

			const site =
				params.host === "github"
					? await options.pages.deploy({
							dir: params.path,
							// The same branch as the last publish, so the URL stays the same
							branch: existing?.siteId ?? (params.branch?.trim() || DEFAULT_PAGES_BRANCH),
							files,
							message: `Rabisco: publish ${screensLabel(snapshot.screens.length)}`,
						})
					: await options.hosts[params.host].deploy({
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

			if (!(await takeDown(file, path, target, "removed")))
				throw new Error("Connect the host again to remove the site. Rabisco needs the token to delete it.");
		},

		/** Takes down every site past its expiry; returns the URLs it removed */
		async sweep(): Promise<string[]> {
			if (!existsSync(dir)) return [];
			const removed: string[] = [];

			for (const name of readdirSync(dir)) {
				if (!name.endsWith(".json")) continue;
				const file = join(dir, name);
				const entry = readEntry(file);

				if (!entry || !expired(entry.target)) continue;
				const { path, target } = entry;

				try {
					if (await takeDown(file, path, target, "expired")) removed.push(target.url);
				} catch (error) {
					console.warn(`Could not take down the expired site ${target.url}:`, error);
				}
			}

			return removed;
		},
	};
}

export type PublishService = ReturnType<typeof createPublishService>;
