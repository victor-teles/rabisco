// Decision 0008. Serves from memory only, GET/HEAD only: nothing on disk is ever served.
import { randomBytes } from "crypto";
import { existsSync, readFileSync } from "fs";
import { networkInterfaces } from "os";
import { join } from "path";
import type { Json } from "../shared/json";
import { assertSnapshot, type ScreenRuntime, type ShareStatus } from "../shared/share/snapshot";
import { viewerFiles } from "../shared/share/viewer";

const TYPES = new Map([
	["html", "text/html; charset=utf-8"],
	["js", "text/javascript; charset=utf-8"],
	["css", "text/css; charset=utf-8"],
]);

type Served = { type: string; body: Uint8Array<ArrayBuffer>; gzip?: Uint8Array<ArrayBuffer> };

type Share = {
	token: string;
	files: Map<string, Served>;
	updatedAt: string;
	screens: number;
};

export type ShareServiceOptions = {
	readRuntime: () => ScreenRuntime;
	/** `0.0.0.0` so people on the same network can open the link */
	hostname?: string;
	/** `0` picks a free port */
	port?: number;
	/** `null` when offline */
	lanAddress?: () => string | null;
	token?: () => string;
	now?: () => Date;
};

export function lanAddress(): string | null {
	const candidates: string[] = [];

	for (const addresses of Object.values(networkInterfaces())) {
		for (const address of addresses ?? []) {
			if (address.family === "IPv4" && !address.internal) candidates.push(address.address);
		}
	}

	const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

	return candidates.find(isPrivate) ?? candidates[0] ?? null;
}

export function readScreenRuntime(dirs: string[]): ScreenRuntime {
	for (const dir of dirs) {
		const html = join(dir, "frame.html");
		const js = join(dir, "frame.js");

		if (existsSync(html) && existsSync(js)) return { html: readFileSync(html, "utf8"), js: readFileSync(js, "utf8") };
	}

	throw new Error(
		"The screen runtime is missing from the app (runtime/frame.js). Run `hutch run ui:build` and try again.",
	);
}

const encoder = new TextEncoder();

function headers(path: string, served: Served, gzip: boolean) {
	const result = new Headers({
		"Content-Type": served.type,
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
		// No Cross-Origin-Resource-Policy: the sandboxed frame has an opaque origin and loads frame.js cross-origin
	});

	// The screen keeps its sandbox even when someone opens the frame on its own
	if (path === "runtime/frame.html") result.set("Content-Security-Policy", "sandbox allow-scripts");

	if (gzip) {
		result.set("Content-Encoding", "gzip");
		result.set("Vary", "Accept-Encoding");
	}

	return result;
}

/** One server for all projects, running only while something is shared. */
export function createShareService(options: ShareServiceOptions) {
	const byProject = new Map<string, Share>();
	const byToken = new Map<string, Share>();
	let server: ReturnType<typeof Bun.serve> | null = null;
	const newToken = options.token ?? (() => randomBytes(18).toString("base64url"));
	const now = options.now ?? (() => new Date());
	const findLan = options.lanAddress ?? lanAddress;

	function handle(request: Request): Response {
		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response("Read-only", { status: 405, headers: { Allow: "GET, HEAD" } });
		}

		const url = new URL(request.url);
		const [, token = "", ...rest] = url.pathname.split("/");
		const share = byToken.get(token);

		if (!share) return new Response("Not found", { status: 404 });

		// `/<token>` → `/<token>/`, so the viewer's relative URLs resolve
		if (rest.length === 0) return new Response(null, { status: 308, headers: { Location: `/${token}/` } });
		let path: string;

		try {
			path = decodeURIComponent(rest.join("/")) || "index.html";
		} catch {
			return new Response("Not found", { status: 404 });
		}

		const served = share.files.get(path);

		if (!served) return new Response("Not found", { status: 404 });
		const gzip = !!served.gzip && /\bgzip\b/.test(request.headers.get("Accept-Encoding") ?? "");
		const body = gzip ? served.gzip! : served.body;

		return new Response(request.method === "HEAD" ? null : body, {
			headers: headers(path, served, gzip),
		});
	}

	function ensureServer() {
		if (server) return server;
		server = Bun.serve({ hostname: options.hostname ?? "0.0.0.0", port: options.port ?? 0, fetch: handle });

		return server;
	}

	function statusOf(share: Share): ShareStatus {
		const port = ensureServer().port;
		const lan = findLan();
		const localUrl = `http://localhost:${port}/${share.token}/`;

		return {
			url: lan ? `http://${lan}:${port}/${share.token}/` : localUrl,
			localUrl,
			updatedAt: share.updatedAt,
			screens: share.screens,
		};
	}

	return {
		handle,

		/** Republishing keeps the same link. */
		publish(projectPath: string, rawSnapshot: Json): ShareStatus {
			const snapshot = assertSnapshot(rawSnapshot);
			const runtime = options.readRuntime();
			const files = new Map<string, Served>();

			for (const file of viewerFiles(snapshot, runtime)) {
				const type = TYPES.get(file.path.split(".").pop() ?? "") ?? "application/octet-stream";
				const body = encoder.encode(file.content);
				files.set(file.path, { type, body, gzip: body.length > 1024 ? Bun.gzipSync(body) : undefined });
			}

			const existing = byProject.get(projectPath);

			const share: Share = {
				token: existing?.token ?? newToken(),
				files,
				updatedAt: now().toISOString(),
				screens: snapshot.screens.length,
			};

			byProject.set(projectPath, share);
			byToken.set(share.token, share);

			return statusOf(share);
		},

		status(projectPath: string): ShareStatus | null {
			const share = byProject.get(projectPath);

			return share ? statusOf(share) : null;
		},

		/** The link dies for good; sharing again makes a new one. */
		stop(projectPath: string) {
			const share = byProject.get(projectPath);

			if (!share) return;
			byProject.delete(projectPath);
			byToken.delete(share.token);

			if (byProject.size === 0 && server) {
				server.stop(true);
				server = null;
			}
		},

		stopAll() {
			for (const path of byProject.keys()) this.stop(path);
		},
	};
}

export type ShareService = ReturnType<typeof createShareService>;
