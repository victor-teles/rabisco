import type { RPCSchema } from "electrobun";
import type { Stat } from "./stats";

export type CompileMode = "transpiler" | "build";

export type BenchRPC = {
	bun: RPCSchema<{
		requests: {
			ping: { params: { payload: string }; response: { payload: string } };
			compileInMain: { params: { source: string; mode: CompileMode }; response: { code: string } };
			report: {
				params: { env: Record<string, string>; results: Stat[]; checks: Record<string, string> };
				response: { ok: true };
			};
		};
		messages: {};
	}>;
	webview: RPCSchema<{ requests: {}; messages: {} }>;
};
