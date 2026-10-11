import { expect, test } from "bun:test";
import { styleState } from "./style-state";

test("notifies on change only", () => {
	let calls = 0;
	const unsubscribe = styleState.subscribe(() => calls++);

	styleState.set("hover");
	styleState.set("hover");
	expect(styleState.current()).toBe("hover");
	expect(calls).toBe(1);

	styleState.set("");
	expect(calls).toBe(2);
	unsubscribe();
});
