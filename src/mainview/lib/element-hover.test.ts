import { expect, test } from "bun:test";
import { elementHover } from "./element-hover";

test("notifies on change only, and a clear from one side keeps the other side's hover", () => {
	let calls = 0;
	const unsubscribe = elementHover.subscribe(() => calls++);

	elementHover.set({ file: "screens/a.tsx", start: 4, from: "canvas" });
	elementHover.set({ file: "screens/a.tsx", start: 4, from: "canvas" });
	expect(calls).toBe(1);

	elementHover.clear("layers");
	expect(elementHover.current()).toEqual({ file: "screens/a.tsx", start: 4, from: "canvas" });

	elementHover.clear("canvas");
	expect(elementHover.current()).toBeNull();
	expect(calls).toBe(2);
	unsubscribe();
});
