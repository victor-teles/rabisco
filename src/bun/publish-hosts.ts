// Decision 0038: the hosts' REST APIs, not their CLIs, so a packaged app needs only `fetch`
import { createHash } from "crypto";
import { isString } from "../shared/guards";
import type { Json } from "../shared/json";
import { PUBLISH_HOST_INFO, type PublishHost } from "../shared/share/publish";
import { arrayOr, objectOr, optionalString, parseJson } from "./json";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type PublishFile = { path: string; body: Uint8Array<ArrayBuffer> };

export type DeployedSite = { siteId: string; siteName: string; url: string };

/** `site` is the one an earlier publish made, so the URL stays the same */
export type DeployRequest = { token: string; files: PublishFile[]; site: DeployedSite | null; newName: string };

export type HostClient = {
	verify(token: string): Promise<void>;
	deploy(request: DeployRequest): Promise<DeployedSite>;
	remove(token: string, siteId: string): Promise<void>;
};

export type HostOptions = { fetch: Fetch; wait?: (ms: number) => Promise<void>; timeoutMs?: number };

const sha1 = (body: Uint8Array) => createHash("sha1").update(body).digest("hex");

const POLL_MS = 1000;

const DEPLOY_TIMEOUT_MS = 3 * 60_000;

const DOMAIN_TRIES = 5;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class HostError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

function errorText(body: Json): string | undefined {
	const root = objectOr(body);
	const nested = objectOr(root.error);

	return optionalString(nested.message) ?? optionalString(root.message) ?? optionalString(root.error);
}

function refusal(host: PublishHost, status: number, body: Json) {
	const { name, tokenHint } = PUBLISH_HOST_INFO[host];

	if (status === 401 || objectOr(objectOr(body).error).invalidToken === true)
		return new HostError(`${name} didn't accept the token. Connect again with a new token.`, status);

	return new HostError(`${name} refused the request: ${errorText(body) ?? status}. ${tokenHint}`, status);
}

function parseBody(text: string): Json {
	try {
		return text ? parseJson(text) : null;
	} catch {
		return text;
	}
}

function createApi(host: PublishHost, base: string, fetch: Fetch) {
	const name = PUBLISH_HOST_INFO[host].name;

	return async function call(token: string, method: string, path: string, body?: Json | Uint8Array<ArrayBuffer>) {
		const headers = new Headers({ Authorization: `Bearer ${token}` });
		let payload: BodyInit | undefined;

		if (body instanceof Uint8Array) {
			headers.set("Content-Type", "application/octet-stream");
			payload = body;
		} else if (body !== undefined) {
			headers.set("Content-Type", "application/json");
			payload = JSON.stringify(body);
		}

		let response: Response;

		try {
			response = await fetch(`${base}${path}`, { method, headers, body: payload });
		} catch (error) {
			throw new Error(`Couldn't reach ${name}. Check your connection and try again.`, { cause: error });
		}

		const text = await response.text();
		const parsed = parseBody(text);

		if (response.status === 401 || response.status === 403) throw refusal(host, response.status, parsed);

		if (!response.ok)
			throw new HostError(
				`${name} answered ${response.status}: ${errorText(parsed) ?? (text.slice(0, 200) || response.statusText)}`,
				response.status,
			);

		return parsed;
	};
}

async function poll(options: HostOptions, read: () => Promise<boolean>) {
	const wait = options.wait ?? sleep;
	const deadline = Date.now() + (options.timeoutMs ?? DEPLOY_TIMEOUT_MS);

	while (!(await read())) {
		if (Date.now() > deadline) throw new Error("The host is still processing the upload. Try again in a minute.");
		await wait(POLL_MS);
	}
}

const required = (value: Json | undefined, what: string) => {
	if (!isString(value) || !value) throw new Error(`The host's answer has no ${what}`);

	return value;
};

export function netlifyHeaders() {
	return [
		"/*",
		"  X-Robots-Tag: noindex",
		"  Referrer-Policy: no-referrer",
		"  X-Content-Type-Options: nosniff",
		"  Cache-Control: no-cache",
		"/runtime/*",
		"  Content-Security-Policy: sandbox allow-scripts",
		"",
	].join("\n");
}

export function vercelConfig() {
	return {
		headers: [
			{
				source: "/(.*)",
				headers: [
					{ key: "X-Robots-Tag", value: "noindex" },
					{ key: "Referrer-Policy", value: "no-referrer" },
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "Cache-Control", value: "no-cache" },
				],
			},
			{
				source: "/runtime/(.*)",
				headers: [{ key: "Content-Security-Policy", value: "sandbox allow-scripts" }],
			},
		],
	};
}

const encoder = new TextEncoder();

export function createNetlify(options: HostOptions): HostClient {
	const call = createApi("netlify", "https://api.netlify.com/api/v1", options.fetch);

	async function createSite(token: string, newName: string): Promise<DeployedSite> {
		const site = objectOr(await call(token, "POST", "/sites", { name: newName }));
		const siteName = required(site.name, "site name");

		return {
			siteId: required(site.id, "site id"),
			siteName,
			url: optionalString(site.ssl_url) ?? `https://${siteName}.netlify.app`,
		};
	}

	async function deployTo(token: string, site: DeployedSite, files: PublishFile[]) {
		const all = [...files, { path: "_headers", body: encoder.encode(netlifyHeaders()) }];
		const digests: Record<string, string> = {};
		const bySha = new Map<string, PublishFile>();

		for (const file of all) {
			const digest = sha1(file.body);
			digests[`/${file.path}`] = digest;
			bySha.set(digest, file);
		}

		const deploy = objectOr(
			await call(token, "POST", `/sites/${encodeURIComponent(site.siteId)}/deploys`, { files: digests }),
		);

		const deployId = required(deploy.id, "deploy id");

		for (const digest of arrayOr(deploy.required)) {
			const file = isString(digest) ? bySha.get(digest) : undefined;

			if (!file) continue;
			const path = file.path.split("/").map(encodeURIComponent).join("/");
			await call(token, "PUT", `/deploys/${encodeURIComponent(deployId)}/files/${path}`, file.body);
		}

		await poll(options, async () => {
			const state = objectOr(await call(token, "GET", `/deploys/${encodeURIComponent(deployId)}`));

			if (state.state === "error")
				throw new Error(`Netlify couldn't deploy the site: ${optionalString(state.error_message) ?? "unknown error"}`);

			return state.state === "ready";
		});
	}

	return {
		async verify(token) {
			await call(token, "GET", "/user");
		},
		async deploy({ token, files, site, newName }) {
			if (site) {
				try {
					await deployTo(token, site, files);

					return site;
				} catch (error) {
					// Deleted on Netlify since the last publish: make a new one
					if (!(error instanceof HostError && error.status === 404)) throw error;
				}
			}

			const created = await createSite(token, newName);
			await deployTo(token, created, files);

			return created;
		},
		async remove(token, siteId) {
			try {
				await call(token, "DELETE", `/sites/${encodeURIComponent(siteId)}`);
			} catch (error) {
				if (!(error instanceof HostError && error.status === 404)) throw error;
			}
		},
	};
}

function vercelAppUrl(names: readonly Json[]) {
	let best: string | undefined;

	for (const name of names)
		if (isString(name) && name.endsWith(".vercel.app") && (!best || name.length < best.length)) best = name;

	return best && `https://${best}`;
}

export function createVercel(options: HostOptions): HostClient {
	const call = createApi("vercel", "https://api.vercel.com", options.fetch);

	async function upload(token: string, file: PublishFile) {
		const digest = sha1(file.body);

		const headers = new Headers({
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/octet-stream",
			"x-vercel-digest": digest,
		});

		let response: Response;

		try {
			response = await options.fetch("https://api.vercel.com/v2/files", {
				method: "POST",
				headers,
				body: file.body,
			});
		} catch (error) {
			throw new Error("Couldn't reach Vercel. Check your connection and try again.", { cause: error });
		}

		if (!response.ok) {
			const text = await response.text();

			if (response.status === 401 || response.status === 403) throw refusal("vercel", response.status, parseBody(text));

			throw new Error(`Vercel didn't take ${file.path} (${response.status}): ${text.slice(0, 200)}`);
		}

		return { file: file.path, sha: digest, size: file.body.byteLength };
	}

	async function productionUrl(token: string, projectId: string, aliases: readonly Json[], fallback: string) {
		const wait = options.wait ?? sleep;
		let names = aliases;

		for (let tries = 0; tries < DOMAIN_TRIES; tries++) {
			const url = vercelAppUrl(names);

			if (url) return url;

			if (tries > 0) await wait(POLL_MS);
			const listed = objectOr(await call(token, "GET", `/v9/projects/${encodeURIComponent(projectId)}/domains`));
			names = arrayOr(listed.domains).map((domain) => objectOr(domain).name ?? null);
		}

		return vercelAppUrl(names) ?? fallback;
	}

	return {
		async verify(token) {
			await call(token, "GET", "/v9/projects?limit=1");
		},
		async deploy({ token, files, site, newName }) {
			const all = [...files, { path: "vercel.json", body: encoder.encode(JSON.stringify(vercelConfig())) }];
			const uploaded = [];

			for (const file of all) uploaded.push(await upload(token, file));

			const created = objectOr(
				await call(token, "POST", "/v13/deployments?skipAutoDetectionConfirmation=1", {
					name: site?.siteName ?? newName,
					files: uploaded,
					target: "production",
					projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null },
				}),
			);

			const deploymentId = required(created.id, "deployment id");
			const projectId = required(created.projectId, "project id");
			let aliases: readonly Json[] = arrayOr(created.alias);

			await poll(options, async () => {
				const state = objectOr(await call(token, "GET", `/v13/deployments/${encodeURIComponent(deploymentId)}`));
				const ready = state.readyState;

				if (ready === "ERROR" || ready === "CANCELED")
					throw new Error(`Vercel couldn't deploy the site: ${errorText(state) ?? ready}`);

				if (ready === "READY") aliases = [...aliases, ...arrayOr(state.alias)];

				return ready === "READY";
			});

			// The deployment URL sits behind Vercel Authentication, so viewers need the project's own domain
			const url =
				site?.siteId === projectId
					? site.url
					: await productionUrl(token, projectId, aliases, `https://${required(created.url, "deployment URL")}`);

			return { siteId: projectId, siteName: site?.siteName ?? newName, url };
		},
		async remove(token, siteId) {
			try {
				await call(token, "DELETE", `/v9/projects/${encodeURIComponent(siteId)}`);
			} catch (error) {
				if (!(error instanceof HostError && error.status === 404)) throw error;
			}
		},
	};
}

export function createHostClients(options: HostOptions): Record<PublishHost, HostClient> {
	return { netlify: createNetlify(options), vercel: createVercel(options) };
}
