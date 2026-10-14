import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import type { JsonObject } from "../shared/json";
import { createNetlify, createVercel, type Fetch } from "./publish-hosts";

type Call = { method: string; url: string; auth: string | null; body: string };

type Route = (call: Call) => Response | undefined;

const json = (body: JsonObject, status = 200) => Response.json(body, { status });

function fakeFetch(routes: Route[]) {
	const calls: Call[] = [];

	const fetch: Fetch = async (url, init) => {
		const headers = new Headers(init?.headers);
		const raw = init?.body;
		const body = raw instanceof Uint8Array ? new TextDecoder().decode(raw) : String(raw ?? "");
		const call = { method: init?.method ?? "GET", url, auth: headers.get("Authorization"), body };
		calls.push(call);

		for (const route of routes) {
			const response = route(call);

			if (response) return response;
		}

		return json({ message: `no route for ${call.method} ${url}` }, 500);
	};

	return { fetch, calls };
}

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

const encode = (text: string) => new TextEncoder().encode(text);

const files = [
	{ path: "index.html", body: encode("<html>") },
	{ path: "runtime/frame.html", body: encode("<frame>") },
];

const noWait = { wait: async () => {} };

describe("Netlify", () => {
	test("makes a site once, uploads only the files Netlify asks for, and waits until it is ready", async () => {
		let polls = 0;

		const { fetch, calls } = fakeFetch([
			({ method, url }) =>
				method === "POST" && url.endsWith("/api/v1/sites")
					? json({ id: "site-1", name: "shop-abc", ssl_url: "https://shop-abc.netlify.app" })
					: undefined,
			({ method, url }) =>
				method === "POST" && url.endsWith("/sites/site-1/deploys")
					? json({ id: "deploy-1", required: [sha1("<frame>")] })
					: undefined,
			({ method, url }) => (method === "PUT" && url.includes("/deploys/deploy-1/files/") ? json({}) : undefined),
			({ method, url }) =>
				method === "GET" && url.endsWith("/deploys/deploy-1")
					? json({ state: ++polls < 2 ? "processing" : "ready" })
					: undefined,
		]);

		const site = await createNetlify({ fetch, ...noWait }).deploy({
			token: "tok",
			files,
			site: null,
			newName: "shop-abc",
		});

		expect(site).toEqual({ siteId: "site-1", siteName: "shop-abc", url: "https://shop-abc.netlify.app" });
		expect(calls.every((call) => call.auth === "Bearer tok")).toBe(true);
		const digests = JSON.parse(calls[1]!.body).files;
		expect(Object.keys(digests).sort()).toEqual(["/_headers", "/index.html", "/runtime/frame.html"]);
		expect(digests["/index.html"]).toBe(sha1("<html>"));
		const uploads = calls.filter((call) => call.method === "PUT");
		expect(uploads.map((call) => call.url)).toEqual([
			"https://api.netlify.com/api/v1/deploys/deploy-1/files/runtime/frame.html",
		]);
		expect(uploads[0]!.body).toBe("<frame>");
		expect(polls).toBe(2);
	});

	test("deploys to the same site again, and makes a new one when it was deleted on Netlify", async () => {
		const known = { siteId: "gone", siteName: "old", url: "https://old.netlify.app" };

		const { fetch, calls } = fakeFetch([
			({ url }) => (url.includes("/sites/gone/") ? json({ message: "Not Found" }, 404) : undefined),
			({ method, url }) =>
				method === "POST" && url.endsWith("/api/v1/sites")
					? json({ id: "site-2", name: "new", ssl_url: "https://new.netlify.app" })
					: undefined,
			({ url }) => (url.endsWith("/sites/site-2/deploys") ? json({ id: "d2", required: [] }) : undefined),
			({ url }) => (url.endsWith("/deploys/d2") ? json({ state: "ready" }) : undefined),
		]);

		const site = await createNetlify({ fetch, ...noWait }).deploy({ token: "t", files, site: known, newName: "new" });
		expect(site.url).toBe("https://new.netlify.app");
		expect(calls[0]!.url).toContain("/sites/gone/deploys");
	});

	test("says when the token is refused, and treats a missing site as removed", async () => {
		const { fetch } = fakeFetch([
			({ url }) => (url.endsWith("/user") ? json({ code: 401, message: "Access Denied" }, 401) : undefined),
			({ method }) => (method === "DELETE" ? json({}, 404) : undefined),
		]);

		const netlify = createNetlify({ fetch, ...noWait });
		await expect(netlify.verify("bad")).rejects.toThrow("Netlify didn't accept the token");
		await expect(netlify.remove("t", "site-1")).resolves.toBeUndefined();
	});

	test("reports a failed deploy with Netlify's message", async () => {
		const { fetch } = fakeFetch([
			({ url }) => (url.endsWith("/sites/s/deploys") ? json({ id: "d", required: [] }) : undefined),
			({ url }) => (url.endsWith("/deploys/d") ? json({ state: "error", error_message: "Too big" }) : undefined),
		]);

		const site = { siteId: "s", siteName: "n", url: "https://n.netlify.app" };

		await expect(createNetlify({ fetch, ...noWait }).deploy({ token: "t", files, site, newName: "n" })).rejects.toThrow(
			"Too big",
		);
	});
});

describe("Vercel", () => {
	test("uploads every file by digest, deploys to production and links the project's vercel.app domain", async () => {
		const { fetch, calls } = fakeFetch([
			({ url }) => (url.endsWith("/v2/files") ? json({}) : undefined),
			({ method, url }) =>
				method === "POST" && url.includes("/v13/deployments")
					? json({ id: "dpl_1", projectId: "prj_1", url: "shop-abc-x1y2.vercel.app" })
					: undefined,
			({ url }) => (url.endsWith("/v13/deployments/dpl_1") ? json({ readyState: "READY" }) : undefined),
			({ url }) =>
				url.endsWith("/v9/projects/prj_1/domains")
					? json({ domains: [{ name: "shop.example.com" }, { name: "shop-abc.vercel.app" }] })
					: undefined,
		]);

		const vercel = createVercel({ fetch, ...noWait });
		const site = await vercel.deploy({ token: "tok", files, site: null, newName: "shop-abc" });

		expect(site).toEqual({ siteId: "prj_1", siteName: "shop-abc", url: "https://shop-abc.vercel.app" });
		const uploads = calls.filter((call) => call.url.endsWith("/v2/files"));
		expect(uploads.map((call) => call.body)).toEqual(["<html>", "<frame>", expect.stringContaining("noindex")]);
		const body = JSON.parse(calls.find((call) => call.url.includes("/v13/deployments?"))!.body);
		expect(body).toMatchObject({ name: "shop-abc", target: "production" });
		expect(body.files).toEqual([
			{ file: "index.html", sha: sha1("<html>"), size: 6 },
			{ file: "runtime/frame.html", sha: sha1("<frame>"), size: 7 },
			expect.objectContaining({ file: "vercel.json" }),
		]);

		const again = await vercel.deploy({ token: "tok", files, site, newName: "ignored" });
		expect(again).toEqual(site);
		expect(calls.filter((call) => call.url.endsWith("/domains"))).toHaveLength(1);
	});

	test("reports a failed build", async () => {
		const { fetch } = fakeFetch([
			({ url }) => (url.endsWith("/v2/files") ? json({}) : undefined),
			({ method, url }) =>
				method === "POST" && url.includes("/v13/deployments")
					? json({ id: "d", projectId: "p", url: "x.vercel.app" })
					: undefined,
			({ url }) =>
				url.endsWith("/v13/deployments/d")
					? json({ readyState: "ERROR", error: { message: "File too large" } })
					: undefined,
		]);

		await expect(
			createVercel({ fetch, ...noWait }).deploy({ token: "t", files, site: null, newName: "n" }),
		).rejects.toThrow("File too large");
	});
});
