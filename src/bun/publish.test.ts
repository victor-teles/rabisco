import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import type { ShareSnapshot } from "../shared/share/snapshot";
import { createMemorySecretStore } from "./ai/keychain";
import { createPublishService, PUBLISH_DIR } from "./publish";
import type { DeployRequest, HostClient } from "./publish-hosts";
import type { PagesClient, PagesDeployRequest } from "./publish-pages";
import { tempDir } from "./test-utils";

const snapshot: ShareSnapshot = {
	version: 1,
	name: "Shop app",
	createdAt: "2026-10-13T00:00:00.000Z",
	start: "screens/home.tsx",
	screens: [{ file: "screens/home.tsx", name: "Home", device: "mobile", width: 390, height: 844 }],
	modules: { "screens/home.tsx": { source: "export default () => <p>Secret plan</p>", code: "x" } },
	css: "",
	theme: "",
};

const runtime = { html: '<script src="./frame.js"></script>', js: "/* runtime */" };

function fakeHost(name: string) {
	const deploys: DeployRequest[] = [];
	const removed: string[] = [];
	let verified: string | null = null;

	const client: HostClient = {
		async verify(token) {
			if (token === "bad") throw new Error("refused");
			verified = token;
		},
		async deploy(request) {
			deploys.push(request);

			return request.site ?? { siteId: `${name}-1`, siteName: request.newName, url: `https://${name}.test/` };
		},
		async remove(_token, siteId) {
			removed.push(siteId);
		},
	};

	return { client, deploys, removed, verified: () => verified };
}

function fakePages() {
	const deploys: PagesDeployRequest[] = [];

	const client: PagesClient = {
		async status() {
			return {
				state: "ready",
				remote: "origin",
				repo: "acme/shop",
				url: "https://acme.github.io/shop/",
				settingsUrl: "https://github.com/acme/shop/settings/pages",
			};
		},
		async deploy(request) {
			deploys.push(request);

			return { siteId: request.branch, siteName: "acme/shop", url: "https://acme.github.io/shop/" };
		},
	};

	return { client, deploys };
}

function setup(
	now = new Date("2026-10-13T12:00:00.000Z"),
	tokens: Record<string, string> = { "publish:netlify": "nt" },
) {
	const userDataDir = tempDir();
	const secrets = createMemorySecretStore(tokens);
	const netlify = fakeHost("netlify");
	const vercel = fakeHost("vercel");
	const pages = fakePages();
	let clock = now;

	const service = createPublishService({
		userDataDir,
		secrets,
		hosts: { netlify: netlify.client, vercel: vercel.client },
		pages: pages.client,
		readRuntime: () => runtime,
		now: () => clock,
		sealRounds: 1000,
	});

	return { service, secrets, netlify, vercel, pages, userDataDir, setNow: (next: Date) => (clock = next) };
}

const fileText = (request: DeployRequest | PagesDeployRequest | undefined, path: string) =>
	new TextDecoder().decode(request?.files.find((file) => file.path === path)?.body);

describe("publish service", () => {
	test("connect checks the token before the keychain gets it; disconnect deletes it", async () => {
		const { service, secrets, vercel } = setup();

		await expect(service.connect("vercel", "bad")).rejects.toThrow("refused");
		expect(await secrets.get("publish:vercel")).toBeNull();
		const hosts = await service.connect("vercel", "  vt  ");
		expect(vercel.verified()).toBe("vt");
		expect(await secrets.get("publish:vercel")).toBe("vt");
		expect(hosts).toEqual([
			{ host: "netlify", connected: true },
			{ host: "vercel", connected: true },
		]);
		expect(await service.disconnect("vercel")).toContainEqual({ host: "vercel", connected: false });
	});

	test("publishes the website, keeps the target in app data and deploys to the same site again", async () => {
		const { service, netlify, userDataDir } = setup();
		const target = await service.publish({ path: "/work/shop", host: "netlify" }, snapshot);

		expect(target).toMatchObject({
			host: "netlify",
			siteId: "netlify-1",
			url: "https://netlify.test/",
			screens: 1,
			locked: false,
			publishedAt: "2026-10-13T12:00:00.000Z",
		});
		expect(target.expiresAt).toBeUndefined();
		expect(netlify.deploys[0]!.token).toBe("nt");
		expect(netlify.deploys[0]!.newName).toMatch(/^design-[0-9a-f]{10}$/);
		expect(netlify.deploys[0]!.files.map((file) => file.path).sort()).toEqual([
			"index.html",
			"runtime/frame.html",
			"snapshot.js",
			"viewer.js",
		]);
		expect(fileText(netlify.deploys[0], "index.html")).toContain('content="noindex"');
		expect(fileText(netlify.deploys[0], "snapshot.js")).toContain("Secret plan");
		expect(service.target("/work/shop")).toEqual(target);
		expect(readdirSync(join(userDataDir, PUBLISH_DIR))).toHaveLength(1);
		expect(service.target("/work/other")).toBeNull();

		await service.publish({ path: "/work/shop", host: "netlify" }, snapshot);
		expect(netlify.deploys[1]!.site).toMatchObject({ siteId: "netlify-1" });
	});

	test("a password seals the snapshot and is not saved", async () => {
		const { service, netlify, userDataDir } = setup();

		await expect(service.publish({ path: "/p", host: "netlify", password: "short" }, snapshot)).rejects.toThrow(
			"at least 8",
		);

		const target = await service.publish({ path: "/p", host: "netlify", password: "long password" }, snapshot);
		expect(target.locked).toBe(true);
		const sealed = fileText(netlify.deploys[0], "snapshot.js");
		expect(sealed).toContain("__RABISCO_SEALED__");
		expect(sealed).not.toContain("Secret plan");
		expect(fileText(netlify.deploys[0], "index.html")).not.toContain("Shop app");

		const saved = readdirSync(join(userDataDir, PUBLISH_DIR)).map((name) =>
			Bun.file(join(userDataDir, PUBLISH_DIR, name)).text(),
		);

		expect(await Promise.all(saved)).not.toContainEqual(expect.stringContaining("long password"));
	});

	test("refuses a past expiry, a missing token and a second host", async () => {
		const { service } = setup();

		await expect(
			service.publish({ path: "/p", host: "netlify", expiresAt: "2026-10-01T00:00:00.000Z" }, snapshot),
		).rejects.toThrow("in the future");
		// SAFETY: a host name that the type rules out, as a bad RPC call could send it
		const unknown = "geocities" as "netlify";
		await expect(service.publish({ path: "/p", host: unknown }, snapshot)).rejects.toThrow(
			"can't publish to geocities",
		);
		await expect(service.publish({ path: "/p", host: "vercel" }, snapshot)).rejects.toThrow("Connect Vercel first");
		await service.publish({ path: "/p", host: "netlify" }, snapshot);
		await expect(service.publish({ path: "/p", host: "vercel" }, snapshot)).rejects.toThrow("another host");
	});

	test("the sweep takes down sites past their expiry and forgets them", async () => {
		const { service, netlify, setNow } = setup();
		const expiresAt = "2026-10-20T00:00:00.000Z";

		const kept = await service.publish({ path: "/kept", host: "netlify" }, snapshot);
		const dated = await service.publish({ path: "/dated", host: "netlify", expiresAt }, snapshot);
		expect(dated.expiresAt).toBe(expiresAt);
		expect(fileText(netlify.deploys[1], "snapshot.js")).toContain(`__RABISCO_EXPIRES__ = "${expiresAt}"`);
		expect(await service.sweep()).toEqual([]);

		setNow(new Date("2026-10-20T00:00:01.000Z"));
		expect(await service.sweep()).toEqual([dated.url]);
		expect(netlify.removed).toEqual(["netlify-1"]);
		expect(service.target("/dated")).toBeNull();
		expect(service.target("/kept")).toEqual(kept);
	});

	test("without the token an expired site waits for the next sweep, and unpublish says why it can't", async () => {
		const { service, secrets, netlify, setNow } = setup();
		await service.publish({ path: "/p", host: "netlify", expiresAt: "2026-10-14T00:00:00.000Z" }, snapshot);
		await secrets.delete("publish:netlify");
		setNow(new Date("2026-10-15T00:00:00.000Z"));

		expect(await service.sweep()).toEqual([]);
		expect(service.target("/p")).not.toBeNull();
		await expect(service.unpublish("/p")).rejects.toThrow("Connect the host again");

		await secrets.set("publish:netlify", "nt");
		await service.unpublish("/p");
		expect(netlify.removed).toEqual(["netlify-1"]);
		expect(service.target("/p")).toBeNull();
	});

	test("publishes to GitHub Pages through git sync, on the same branch each time, with no token", async () => {
		const { service, pages } = setup(undefined, {});
		// SAFETY: a host that the type rules out, as a bad RPC call could send it
		const github = "github" as "netlify";
		await expect(service.connect(github, "x")).rejects.toThrow("doesn't use a token");

		const target = await service.publish(
			{ path: "/work/shop", host: "github", branch: " site ", password: "long password" },
			snapshot,
		);

		expect(target).toMatchObject({
			host: "github",
			siteId: "site",
			siteName: "acme/shop",
			url: "https://acme.github.io/shop/",
			locked: true,
		});
		expect(pages.deploys[0]).toMatchObject({ dir: "/work/shop", branch: "site", message: "Rabisco: publish 1 screen" });
		expect(fileText(pages.deploys[0], "snapshot.js")).not.toContain("Secret plan");
		expect(await service.pages("/work/shop")).toMatchObject({ state: "ready", repo: "acme/shop" });

		await service.publish({ path: "/work/shop", host: "github", branch: "other" }, snapshot);
		expect(pages.deploys[1]!.branch).toBe("site");

		await service.publish({ path: "/work/blog", host: "github" }, snapshot);
		expect(pages.deploys[2]!.branch).toBe("gh-pages");

		await service.unpublish("/work/shop");
		expect(pages.deploys[3]).toMatchObject({ dir: "/work/shop", branch: "site", message: "Rabisco: remove the site" });
		expect(pages.deploys[3]!.files.map((file) => file.path)).toEqual(["index.html"]);
		expect(fileText(pages.deploys[3], "index.html")).toContain("This site was removed");
		expect(service.target("/work/shop")).toBeNull();
	});

	test("the sweep replaces an expired GitHub Pages site with an expired page", async () => {
		const { service, pages, setNow } = setup();
		await service.publish({ path: "/work/shop", host: "github", expiresAt: "2026-10-14T00:00:00.000Z" }, snapshot);
		setNow(new Date("2026-10-15T00:00:00.000Z"));

		expect(await service.sweep()).toEqual(["https://acme.github.io/shop/"]);
		expect(pages.deploys[1]).toMatchObject({ dir: "/work/shop", branch: "gh-pages" });
		expect(fileText(pages.deploys[1], "index.html")).toContain("This link has expired");
		expect(service.target("/work/shop")).toBeNull();
	});

	test("the sweep is a no-op before anything was published", async () => {
		const { service, userDataDir } = setup();
		expect(await service.sweep()).toEqual([]);
		expect(existsSync(join(userDataDir, PUBLISH_DIR))).toBe(false);
	});
});
