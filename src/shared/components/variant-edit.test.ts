import { describe, expect, test } from "bun:test";
import {
	addVariantOption,
	optionCounts,
	optionError,
	removeVariantOption,
	setVariantClasses,
	tableFor,
	variantTables,
	variantUsages,
} from "./variant-edit";

const BUTTON = `import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva("inline-flex items-center", {
	variants: {
		variant: {
			default: "bg-primary text-primary-foreground",
			outline: "border bg-background",
		},
		size: { sm: "h-8 px-3", md: "h-9 px-4" },
	},
	defaultVariants: { variant: "default", size: "md" },
});

export function Button({ variant, size, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
	return <button className={buttonVariants({ variant, size })} {...props} />;
}
`;

describe("variantTables", () => {
	test("reads axes, options, classes and defaults", () => {
		const [table] = variantTables(BUTTON);

		expect(table!.name).toBe("buttonVariants");
		expect(table!.axes.map((axis) => [axis.name, axis.default, axis.multiline])).toEqual([
			["variant", "default", true],
			["size", "md", false],
		]);
		expect(table!.axes[0]!.options.map((option) => [option.name, option.classes])).toEqual([
			["default", "bg-primary text-primary-foreground"],
			["outline", "border bg-background"],
		]);
	});

	test("finds the table for a component's axes", () => {
		expect(tableFor(BUTTON, ["size", "variant"])?.name).toBe("buttonVariants");
		expect(tableFor(BUTTON, ["tone"])).toBeNull();
	});

	test("a value that isn't a string can't be edited", () => {
		const source = `const v = cva("", { variants: { tone: { a: cn("x"), b: "y" } } });`;

		expect(variantTables(source)[0]!.axes[0]!.options.map((o) => o.classes)).toEqual([null, "y"]);
		expect(setVariantClasses(source, "v", "tone", "a", "z")).toBeNull();
	});
});

describe("editing", () => {
	test("sets an option's classes in place", () => {
		const next = setVariantClasses(BUTTON, "buttonVariants", "size", "sm", "h-7  px-2 'x'");

		expect(next).toContain(`size: { sm: "h-7 px-2 x", md: "h-9 px-4" },`);
	});

	test("adds an option on its own line in a multi-line axis", () => {
		const next = addVariantOption(BUTTON, "buttonVariants", "variant", "Ghost", "hover:bg-accent")!;

		expect(next).toContain(`\t\t\toutline: "border bg-background",\n\t\t\tghost: "hover:bg-accent",\n\t\t},`);
		expect(variantTables(next)[0]!.axes[0]!.options.map((o) => o.name)).toEqual(["default", "outline", "ghost"]);
	});

	test("adds an option to a one-line axis", () => {
		const next = addVariantOption(BUTTON, "buttonVariants", "size", "Extra large", "h-12 px-6")!;

		expect(next).toContain(`size: { sm: "h-8 px-3", md: "h-9 px-4", "extra-large": "h-12 px-6" },`);
	});

	test("refuses a name the axis has", () => {
		const axis = variantTables(BUTTON)[0]!.axes[1]!;

		expect(optionError(axis, "SM")).toBe("size already has sm");
		expect(optionError(axis, "  ")).toBe("Name the option");
		expect(addVariantOption(BUTTON, "buttonVariants", "size", "md", "x")).toBeNull();
	});

	test("removes an option, but not the default", () => {
		const multi = removeVariantOption(BUTTON, "buttonVariants", "variant", "outline")!;

		expect(multi).toContain(`\t\t\tdefault: "bg-primary text-primary-foreground",\n\t\t},`);

		const single = removeVariantOption(BUTTON, "buttonVariants", "size", "sm")!;

		expect(single).toContain(`size: { md: "h-9 px-4" },`);
		expect(removeVariantOption(BUTTON, "buttonVariants", "size", "md")).toBeNull();
	});
});

describe("variantUsages", () => {
	const files = {
		"components/button.tsx": BUTTON,
		"screens/home.tsx": `import { Button as Action } from "../components/button";

export default function Home({ big }: { big: boolean }) {
	return (
		<div>
			<Action variant="outline">One</Action>
			<Action size={big ? "md" : "sm"}>Two</Action>
			<Action variant={"outline"} size="sm" />
		</div>
	);
}
`,
		"screens/other.tsx": `export default function Other() {
	return <Button>Not imported</Button>;
}
`,
	};

	test("reads each usage's options through the import's local name", () => {
		const usages = variantUsages(files, "components/button.tsx", "Button", ["variant", "size"]);

		expect(usages.map((usage) => usage.values)).toEqual([
			{ variant: "outline", size: null },
			{ variant: null, size: "*" },
			{ variant: "outline", size: "sm" },
		]);
		expect(usages.every((usage) => usage.path === "screens/home.tsx")).toBe(true);
	});

	test("counts unset axes for the default", () => {
		const usages = variantUsages(files, "components/button.tsx", "Button", ["variant", "size"]);

		expect([...optionCounts(usages, "variant", "default")]).toEqual([
			["outline", 2],
			["default", 1],
		]);
		expect(optionCounts(usages, "size", "md").get("*")).toBe(1);
	});
});
