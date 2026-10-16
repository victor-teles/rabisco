import { describe, expect, test } from "bun:test";
import { compiles } from "../jsx/test-fixtures";
import {
	applyOverrides,
	detachUsage,
	instanceAt,
	overrideAttribute,
	overrideClassChange,
	overrideClasses,
	overrideText,
	resetOverrides,
	usageClasses,
	usageOverrides,
	type InstanceResult,
} from "./instances";

const CARD = `import { Button } from "@/components/ui/button";

type PlanCardProps = {
	title: string;
};

export function PlanCard({ title }: PlanCardProps) {
	return (
		<div className="rounded-lg border p-4">
			<h3 className="font-semibold">{title}</h3>
			<img src="/plan.png" alt="Plan" />
			<Button className="mt-2">Choose</Button>
		</div>
	);
}
`;

const PRICING = `import { PlanCard } from "../components/plan-card";

export default function Pricing() {
	return (
		<main className="grid gap-4">
			<PlanCard title="Free" />
			<PlanCard title="Pro" />
		</main>
	);
}
`;

const files = { "components/plan-card.tsx": CARD, "screens/pricing.tsx": PRICING };

const at = (source: string, needle: string, nth = 0) => {
	let index = -1;

	for (let i = 0; i <= nth; i++) index = source.indexOf(needle, index + 1);

	if (index < 0) throw new Error(`missing ${needle}`);

	return index;
};

const second = { path: "screens/pricing.tsx", start: at(PRICING, "<PlanCard", 1) };

function ok(result: InstanceResult) {
	if (!result.ok) throw new Error(result.reason);

	for (const change of result.changes) expect(compiles(change.content!)).toBe(true);

	return result;
}

function applied(result: InstanceResult, base: Record<string, string> = files) {
	const next = { ...base };

	for (const change of ok(result).changes) next[change.path] = change.content!;

	return next;
}

describe("instanceAt", () => {
	test("finds the component a usage renders", () => {
		const instance = instanceAt(files, second.path, second.start);

		expect(instance?.componentPath).toBe("components/plan-card.tsx");
		expect(instance?.exportName).toBe("PlanCard");
	});

	test("ignores intrinsic elements and ui components", () => {
		expect(instanceAt(files, "screens/pricing.tsx", at(PRICING, "<main"))).toBeNull();
		expect(instanceAt(files, "components/plan-card.tsx", at(CARD, "<Button"))).toBeNull();
	});
});

describe("overrideText", () => {
	test("turns fixed text into a prop and sets it on one usage", () => {
		const next = applied(overrideText(files, second, at(CARD, "<Button"), "Upgrade"));

		expect(next["components/plan-card.tsx"]).toContain(`<Button className="mt-2">{label}</Button>`);
		expect(next["components/plan-card.tsx"]).toContain(
			`export function PlanCard({ title, label = "Choose" }: PlanCardProps)`,
		);
		expect(next["components/plan-card.tsx"]).toContain(`\ttitle: string;\n\tlabel?: string;\n};`);
		expect(next["screens/pricing.tsx"]).toContain(`<PlanCard title="Free" />`);
		expect(next["screens/pricing.tsx"]).toContain(`<PlanCard title="Pro" label="Upgrade" />`);
		expect(usageOverrides(next, second)).toEqual([{ name: "label", kind: "text", value: "Upgrade" }]);
	});

	test("an existing prop is set at the call site only", () => {
		const next = applied(overrideText(files, second, at(CARD, "<h3"), "Team"));

		expect(next["components/plan-card.tsx"]).toBe(CARD);
		expect(next["screens/pricing.tsx"]).toContain(`<PlanCard title="Team" />`);
	});

	test("writing the default back removes the override", () => {
		const once = applied(overrideText(files, second, at(CARD, "<Button"), "Upgrade"));
		const start = at(once["components/plan-card.tsx"]!, "<Button");
		const back = applied(overrideText(once, second, start, "Choose"), once);

		expect(back["screens/pricing.tsx"]).toContain(`<PlanCard title="Pro" />`);
	});
});

describe("overrideAttribute", () => {
	test("turns a string attribute into a prop", () => {
		const next = applied(overrideAttribute(files, second, at(CARD, "<img"), "alt", "Pro plan"));

		expect(next["components/plan-card.tsx"]).toContain(`<img src="/plan.png" alt={alt} />`);
		expect(next["screens/pricing.tsx"]).toContain(`<PlanCard title="Pro" alt="Pro plan" />`);
	});
});

describe("overrideClasses", () => {
	test("a className attribute edit is a class override", () => {
		const next = applied(overrideAttribute(files, second, at(CARD, "<Button"), "className", "mt-4"));

		expect(next["screens/pricing.tsx"]).toContain(`buttonClassName="mt-4"`);
	});

	test("root classes go in a merged className at the call site", () => {
		const next = applied(overrideClasses(files, second, at(CARD, "<div"), "rounded-lg border p-6 bg-muted"));

		expect(next["components/plan-card.tsx"]).toContain(`<div className={cn("rounded-lg border p-4", className)}>`);
		expect(next["components/plan-card.tsx"]).toContain(`import { cn } from "@/lib/utils";`);
		expect(next["components/plan-card.tsx"]).toContain(`{ title, className }`);
		expect(next["screens/pricing.tsx"]).toContain(`<PlanCard title="Pro" className="p-6 bg-muted" />`);
		expect(usageClasses(next, second, at(next["components/plan-card.tsx"]!, "<div"))).toBe(
			"rounded-lg border p-6 bg-muted",
		);
	});

	test("nested classes get a prop named for the element", () => {
		const next = applied(overrideClasses(files, second, at(CARD, "<Button"), "mt-4"));

		expect(next["components/plan-card.tsx"]).toContain(`<Button className={cn("mt-2", buttonClassName)}>`);
		expect(next["screens/pricing.tsx"]).toContain(`buttonClassName="mt-4"`);
	});
});

describe("overrideClassChange", () => {
	test("keeps the usage's other overrides", () => {
		const div = at(CARD, "<div");
		let next = applied(overrideClasses(files, second, div, "rounded-lg border p-4 bg-muted"));
		const start = at(next["components/plan-card.tsx"]!, "<div");
		next = applied(overrideClassChange(next, second, start, "rounded-lg border p-4", "rounded-lg border p-6"), next);

		expect(next["screens/pricing.tsx"]).toContain(`className="bg-muted p-6"`);
	});
});

describe("reset and apply", () => {
	const overridden = () => {
		let next = applied(overrideText(files, second, at(CARD, "<Button"), "Upgrade"));
		const div = at(next["components/plan-card.tsx"]!, "<div");
		next = applied(overrideClasses(next, second, div, "rounded-lg border p-4 bg-muted"), next);

		return next;
	};

	test("reset removes every override from the usage", () => {
		const next = overridden();
		const reset = applied(resetOverrides(next, second), next);

		expect(reset["screens/pricing.tsx"]).toBe(PRICING);
		expect(usageOverrides(reset, second)).toEqual([]);
	});

	test("apply moves the overrides into the component", () => {
		const next = overridden();
		const done = applied(applyOverrides(next, second), next);

		expect(done["screens/pricing.tsx"]).toBe(PRICING);
		expect(done["components/plan-card.tsx"]).toContain(`label = "Upgrade"`);
		expect(done["components/plan-card.tsx"]).toContain(`cn("rounded-lg border p-4 bg-muted", className)`);
	});
});

describe("detachUsage", () => {
	test("inlines the component's JSX with the usage's props", () => {
		const result = ok(detachUsage(files, second));
		const next = applied(result);

		expect(next["screens/pricing.tsx"]!.startsWith("<div", result.start)).toBe(true);

		expect(next["screens/pricing.tsx"]).toBe(`import { PlanCard } from "../components/plan-card";
import { Button } from "@/components/ui/button";

export default function Pricing() {
	return (
		<main className="grid gap-4">
			<PlanCard title="Free" />
			<div className="rounded-lg border p-4">
				<h3 className="font-semibold">Pro</h3>
				<img src="/plan.png" alt="Plan" />
				<Button className="mt-2">Choose</Button>
			</div>
		</main>
	);
}
`);
	});

	test("merges call-site classes and drops the import when no usage is left", () => {
		const single = { ...files, "screens/pricing.tsx": PRICING.replace(`\t\t\t<PlanCard title="Free" />\n`, "") };
		const usage = { path: "screens/pricing.tsx", start: at(single["screens/pricing.tsx"], "<PlanCard") };
		let next = applied(overrideClasses(single, usage, at(CARD, "<div"), "rounded-lg border p-4 bg-muted"), single);
		next = applied(detachUsage(next, usage), next);

		expect(next["screens/pricing.tsx"]).not.toContain("PlanCard");
		expect(next["screens/pricing.tsx"]).toContain(`<div className="rounded-lg border p-4 bg-muted">`);
	});

	test("refuses a component with logic before its return", () => {
		const logic = { ...files, "components/plan-card.tsx": CARD.replace("\treturn (", "\tconst x = 1;\n\treturn (") };

		expect(detachUsage(logic, second).ok).toBe(false);
	});
});
