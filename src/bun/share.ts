/**
 * Share a read-only link (decision 0008): a small HTTP server in the main
 * process serves each shared project's viewer (`src/shared/share/viewer.ts`)
 * from memory, under a random token. GET and HEAD only; nothing on disk is
 * ever served. Independent of Electrobun so it can be tested.
 */
import { randomBytes } from "crypto";
import { existsSync, readFileSync } from "fs";
import { networkInterfaces } from "os";
import { join } from "path";
import { assertSnapshot, type ScreenRuntime, type ShareStatus } from "../shared/share/snapshot";
import { viewerFiles } from "../shared/share/viewer";

const TYPES: Record<string, string> = {
	html: "text/html; charset=utf-8",
	js: "text/javascript; charset=utf-8",
	css: "text/css; charset=utf-8",
};

type Served = { type: string; body: Uint8Array; gzip?: Uint8Array };

type Share = {
	token: string;
	files: Map<string, Served>;
	updatedAt: string;
	screens: number;
};

export type ShareServiceOptions = {
	/** The screen runtime the canvas uses (`runtime/frame.html` and `frame.js`) */
	readRuntime: () => ScreenRuntime;
	/** Interface the server listens on: `0.0.0.0` so people on the same network can open the link */
	hostname?: string;
	/** `0` picks a free port */
	port?: number;
	/** The computer's address on the local network, for the link; `null` when offline */
	lanAddress?: () => string | null;
	/** Random URL token; injectable for tests */
	token?: () => string;
	now?: () => Date;
};

/** The first private IPv4 address of this computer, or `null` when there is none. */
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

/**
 * Reads the screen runtime from the first folder that has it: the app bundle's
 * `views/mainview/runtime`, then the source tree (development).
 */
export function readScreenRuntime(dirs: string[]): ScreenRuntime {
	for (const dir of dirs) {
		const html = join(dir, "frame.html");
		const js = join(dir, "frame.js");
		if (existsSync(html) && existsSync(js)) return { html: readFileSync(html, "utf8"), js: readFileSync(js, "utf8") };
	}
	throw new Error("The screen runtime is missing from the app (runtime/frame.js). Run `hutch run ui:build` and try again.");
}

const encoder = new TextEncoder();

function headers(path: string, served: Served, gzip: boolean) {
	const result: Record<string, string> = {
		"Content-Type": served.type,
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
		// No Cross-Origin-Resource-Policy: the sandboxed frame has an opaque origin and loads frame.js cross-origin
	};
	// The screen keeps its sandbox even when someone opens the frame on its own
	if (path === "runtime/frame.html") result["Content-Security-Policy"] = "sandbox allow-scripts";
	if (gzip) {
		result["Content-Encoding"] = "gzip";
		result.Vary = "Accept-Encoding";
	}
	return result;
}

/** Share links for any number of projects, served by one server that runs only while something is shared. */
export function createShareService(options: ShareServiceOptions) {
	const byProject = new Map<string, Share>();
	const byToken = new Map<string, Share>();
	let server: ReturnType<typeof Bun.serve> | null = null;
	const newToken = options.token ?? (() => randomBytes(18).toString("base64url"));
	const now = options.now ?? (() => new Date());
	const findLan = options.lanAddress ?? lanAddress;

	/** Answers one request. Exported for tests through the service. */
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
		return new Response(request.method === "HEAD" ? null : (body as BodyInit), { headers: headers(path, served, gzip) });
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
		return { url: lan ? `http://${lan}:${port}/${share.token}/` : localUrl, localUrl, updatedAt: share.updatedAt, screens: share.screens };
	}

	return {
		handle,

		/** Starts sharing `projectPath`, or updates what its link shows. The link stays the same. */
		publish(projectPath: string, rawSnapshot: unknown): ShareStatus {
			const snapshot = assertSnapshot(rawSnapshot);
			const runtime = options.readRuntime();
			const files = new Map<string, Served>();
			for (const file of viewerFiles(snapshot, runtime)) {
				const type = TYPES[file.path.split(".").pop()!] ?? "application/octet-stream";
				const body = encoder.encode(file.content);
				files.set(file.path, { type, body, gzip: body.length > 1024 ? Bun.gzipSync(body) : undefined });
			}
			const existing = byProject.get(projectPath);
			const share: Share = { token: existing?.token ?? newToken(), files, updatedAt: now().toISOString(), screens: snapshot.screens.length };
			byProject.set(projectPath, share);
			byToken.set(share.token, share);
			return statusOf(share);
		},

		/** The project's link, or `null` when it isn't shared. */
		status(projectPath: string): ShareStatus | null {
			const share = byProject.get(projectPath);
			return share ? statusOf(share) : null;
		},

		/** Stops sharing: the link stops working for good (sharing again makes a new one). */
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
			for (const path of [...byProject.keys()]) this.stop(path);
		},
	};
}

export type ShareService = ReturnType<typeof createShareService>;
