import { expect, test } from "bun:test";
import hutchConfig from "../../hutch.config";

test("bench:gen runs the eval with real Bun, not in the Cottontail shell", () => {
	expect(hutchConfig.scripts["bench:gen"]).toEqual(["bun", "bench/gen/eval.ts"]);
});
