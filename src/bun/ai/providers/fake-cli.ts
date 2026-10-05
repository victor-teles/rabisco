/**
 * Test helper: a fake `SpawnFn` that plays back recorded CLI output, and can
 * act on the staging dir (write files) like a real agent would.
 */

import type { SpawnFn, SpawnOptions } from "../cli";

export type FakeRun = {
	/** JSON values (stringified) or raw lines, written to stdout in order */
	stdout?: (unknown | string)[];
	stderr?: string;
	exitCode?: number;
	/** Runs before stdout is written, with the process cwd */
	act?: (cwd: string) => Promise<void> | void;
	/** Never exits on its own; only a kill ends it */
	hang?: boolean;
	/** Throw like Bun.spawn does when the binary is missing */
	throws?: NodeJS.ErrnoException;
};

export type FakeCall = { cmd: string[]; options: SpawnOptions; killed: (string | number | undefined)[] };

const encoder = new TextEncoder();

export function fakeSpawn(runs: FakeRun | ((cmd: string[]) => FakeRun)) {
	const calls: FakeCall[] = [];
	const spawn: SpawnFn = (cmd, options) => {
		const run = typeof runs === "function" ? runs(cmd) : runs;
		if (run.throws) throw run.throws;
		const call: FakeCall = { cmd, options, killed: [] };
		calls.push(call);
		let exit!: (code: number) => void;
		const exited = new Promise<number>((resolve) => (exit = resolve));
		let out!: ReadableStreamDefaultController<Uint8Array>;
		const stdout = new ReadableStream<Uint8Array>({ start: (controller) => void (out = controller) });
		const stderr = new ReadableStream<Uint8Array>({
			start(controller) {
				if (run.stderr) controller.enqueue(encoder.encode(run.stderr));
				controller.close();
			},
		});
		let closed = false;
		const close = (code: number) => {
			if (closed) return;
			closed = true;
			try {
				out.close();
			} catch {}
			exit(code);
		};
		void (async () => {
			await run.act?.(options.cwd ?? ".");
			for (const line of run.stdout ?? []) {
				if (closed) return;
				try {
					out.enqueue(encoder.encode(`${typeof line === "string" ? line : JSON.stringify(line)}\n`));
				} catch {
					break; // The reader cancelled
				}
				await new Promise((resolve) => setTimeout(resolve, 1));
			}
			if (!run.hang) close(run.exitCode ?? 0);
		})();
		return {
			stdout,
			stderr,
			exited,
			kill(signal) {
				call.killed.push(signal);
				close(143);
			},
		};
	};
	return { spawn, calls };
}
