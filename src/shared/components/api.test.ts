import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateMockScreens } from "../mock-generator";
import { componentApi, propsSignature, type ComponentExport } from "./api";

const api = (source: string) => componentApi("components/x.tsx", source).exports;
const one = (source: string) => api(source)[0]!;
const prop = (exp: ComponentExport, name: string) => exp.props.find((p) => p.name === name);

const STAT_CARD = `import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" }) {
	return (
		<Card>
			<CardContent className="px-4">
				<p className="text-sm text-muted-foreground">{label}</p>
				<p className="text-2xl font-semibold">{value}</p>
				<p>Don't {tone === "success" ? "worry" : "panic"}</p>
			</CardContent>
		</Card>
	);
}
`;

describe("componentApi", () => {
	test("inline props type with a default", () => {
		const exp = one(STAT_CARD);
		expect(exp.name).toBe("StatCard");
		expect(exp.props).toEqual([
			{ name: "label", type: { kind: "string" }, optional: false },
			{ name: "value", type: { kind: "string" }, optional: false },
			{ name: "tone", type: { kind: "enum", options: ["default", "success"] }, optional: true, default: "default" },
		]);
		expect(exp.acceptsChildren).toBe(false);
		expect(exp.extendsElement).toBeUndefined();
		expect(propsSignature(exp)).toBe('StatCard({ label: string; value: string; tone?: "default" | "success" = "default" })');
	});

	test("named type alias, icons, handlers, children, arrays and objects", () => {
		const exp = one(`import type { LucideIcon } from "lucide-react";
import type * as React from "react";

type Tone = "neutral" | "warning";

type ListRowProps = {
	title: string;
	count?: number;
	icon: LucideIcon;
	tone?: Tone;
	selected?: boolean;
	onClick: () => void;
	onSelect?: (id: string, index: number) => void;
	onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
	children: React.ReactNode;
	tags: string[];
	meta: { label: string; value: string };
	trailing?: React.ReactElement | null;
};

export function ListRow({ title, count = 3, icon: Icon, tone = "neutral", selected = false, children }: ListRowProps) {
	return <div>{title}{count}<Icon />{children}</div>;
}
`);
		const types = Object.fromEntries(exp.props.map((p) => [p.name, p.type]));
		expect(types).toEqual({
			title: { kind: "string" },
			count: { kind: "number" },
			icon: { kind: "other", text: "LucideIcon" },
			tone: { kind: "enum", options: ["neutral", "warning"] },
			selected: { kind: "boolean" },
			onClick: { kind: "function", text: "() => void" },
			onSelect: { kind: "function", text: "(id: string, index: number) => void" },
			onKeyDown: { kind: "function", text: "React.KeyboardEventHandler<HTMLDivElement>" },
			children: { kind: "node" },
			tags: { kind: "other", text: "string[]" },
			meta: { kind: "other", text: "{ label: string; value: string }" },
			trailing: { kind: "node" },
		});
		expect(prop(exp, "count")).toMatchObject({ optional: true, default: 3 });
		expect(prop(exp, "selected")).toMatchObject({ default: false });
		expect(prop(exp, "icon")).toMatchObject({ optional: false });
		expect(prop(exp, "icon")!.default).toBeUndefined();
		expect(exp.acceptsChildren).toBe(true);
	});

	test("interface, extends and line-separated members", () => {
		const exp = one(`import * as React from "react";
interface BaseProps {
	id: string
	disabled?: boolean
}
interface ChipProps extends BaseProps, React.HTMLAttributes<HTMLSpanElement> {
	label: string
	size?:
		| "sm"
		| "md"
}
export function Chip({ label, size = "sm", ...props }: ChipProps) {
	return <span {...props}>{label}</span>;
}
`);
		expect(exp.props.map((p) => p.name)).toEqual(["label", "size", "id", "disabled"]);
		expect(prop(exp, "size")).toEqual({ name: "size", type: { kind: "enum", options: ["sm", "md"] }, optional: true, default: "sm" });
		expect(exp.extendsElement).toBe("span");
		expect(exp.acceptsChildren).toBe(true);
	});

	test("cva variants with ComponentProps and VariantProps", () => {
		const exp = one(`import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pillVariants = cva("inline-flex items-center rounded-full", {
	variants: {
		tone: { neutral: "bg-muted", success: "bg-emerald-100 text-emerald-700", "very-loud": "bg-primary" },
		size: { sm: "h-6 px-2 text-xs", md: "h-8 px-3 text-sm" },
		pressed: { true: "ring-2", false: "" },
	},
	defaultVariants: { tone: "neutral", size: "md", pressed: false },
});

export function Pill({ className, tone, size, ...props }: React.ComponentProps<"button"> & VariantProps<typeof pillVariants> & { label?: string }) {
	return <button className={cn(pillVariants({ tone, size }), className)} {...props} />;
}
`);
		expect(exp.variants).toEqual({
			tone: { options: ["neutral", "success", "very-loud"], default: "neutral" },
			size: { options: ["sm", "md"], default: "md" },
			pressed: { options: ["true", "false"], default: "false" },
		});
		expect(exp.props).toEqual([
			{ name: "label", type: { kind: "string" }, optional: true },
			{ name: "tone", type: { kind: "enum", options: ["neutral", "success", "very-loud"] }, optional: true, default: "neutral" },
			{ name: "size", type: { kind: "enum", options: ["sm", "md"] }, optional: true, default: "md" },
			{ name: "pressed", type: { kind: "boolean" }, optional: true, default: false },
		]);
		expect(exp.extendsElement).toBe("button");
		expect(exp.acceptsChildren).toBe(true);
		expect(propsSignature(exp)).toContain('...props: ComponentProps<"button">');
	});

	test("arrow components, forwardRef, memo and FC", () => {
		const exports = api(`import * as React from "react";
import { forwardRef, memo } from "react";

type FieldProps = { label: string; hint?: string } & React.ComponentPropsWithoutRef<"input">;

export const Field = forwardRef<HTMLInputElement, FieldProps>(({ label, hint, ...props }, ref) => (
	<label>{label}<input ref={ref} {...props} />{hint}</label>
));

export const Avatar = React.forwardRef(function Avatar({ initials }: { initials: string }, ref: React.Ref<HTMLDivElement>) {
	return <div ref={ref}>{initials}</div>;
});

export const Divider = () => <hr className="border-border" />;

export const Price = memo(({ amount, currency = "USD" }: { amount: number; currency?: string }) => <span>{amount}{currency}</span>);

export const Section: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => <section>{title}{children}</section>;

export const Heading = async ({ level }: { level: 1 | 2 | 3 }) => <h1>{level}</h1>;
`);
		expect(exports.map((e) => e.name)).toEqual(["Field", "Avatar", "Divider", "Price", "Section", "Heading"]);
		const [field, avatar, divider, price, section, heading] = exports as [ComponentExport, ComponentExport, ComponentExport, ComponentExport, ComponentExport, ComponentExport];
		expect(field.props.map((p) => p.name)).toEqual(["label", "hint"]);
		expect(field.extendsElement).toBe("input");
		expect(field.acceptsChildren).toBe(false);
		expect(avatar.props).toEqual([{ name: "initials", type: { kind: "string" }, optional: false }]);
		expect(propsSignature(divider)).toBe("Divider()");
		expect(prop(price, "currency")).toMatchObject({ type: { kind: "string" }, default: "USD" });
		expect(section.acceptsChildren).toBe(true);
		expect(prop(heading, "level")!.type).toEqual({ kind: "other", text: "1 | 2 | 3" });
	});

	test("export lists, renames, non-components and default exports", () => {
		const exports = api(`function Toolbar({ dense = false }: { dense?: boolean }) { return <div />; }
function helper() { return 1; }
const items = [1, 2];
export const NAV_ITEMS = ["Home", "Saved"];
export const buttonish = () => <div />;
export default function Ignored() { return null; }
export type { ToolbarProps } from "./other";
export { Toolbar, Toolbar as Bar, helper, items };
`);
		expect(exports.map((e) => e.name)).toEqual(["Toolbar", "Bar"]);
		expect(exports[1]!.props).toEqual([{ name: "dense", type: { kind: "boolean" }, optional: true, default: false }]);
	});

	test("Omit, Partial, Pick, PropsWithChildren and untyped params", () => {
		const exports = api(`import type { PropsWithChildren } from "react";
type Base = { title: string; subtitle: string; tone: "a" | "b" };
export function A(props: Omit<Base, "tone">) { return <div>{props.title}</div>; }
export function B(props: Partial<Base>) { return <div />; }
export function C({ title }: Pick<Base, "title">) { return <div>{title}</div>; }
export function D({ children, open = true }: PropsWithChildren<{ open?: boolean }>) { return <div>{children}</div>; }
export function E({ label, size = 2 }) { return <div>{label}{size}</div>; }
export function F(props) { return <div />; }
`);
		const [a, b, c, d, e, f] = exports as ComponentExport[];
		expect(a!.props.map((p) => p.name)).toEqual(["title", "subtitle"]);
		expect(b!.props.every((p) => p.optional)).toBe(true);
		expect(c!.props.map((p) => p.name)).toEqual(["title"]);
		expect(d!.props).toEqual([
			{ name: "children", type: { kind: "node" }, optional: true },
			{ name: "open", type: { kind: "boolean" }, optional: true, default: true },
		]);
		expect(d!.acceptsChildren).toBe(true);
		expect(e!.props).toEqual([
			{ name: "label", type: { kind: "other", text: "unknown" }, optional: false },
			{ name: "size", type: { kind: "other", text: "unknown" }, optional: true, default: 2 },
		]);
		expect(f!.props).toEqual([]);
	});

	test("recursive and unknown types don't loop", () => {
		const exp = one(`type A = B & { a: string };
type B = A & { b: number };
export function Loop(props: A & Missing & Record<string, unknown>) { return null; }
`);
		expect(exp.props.map((p) => p.name).sort()).toEqual(["a", "b"]);
	});

	test("never throws: syntax errors, partial files and garbage give no exports", () => {
		for (const source of ["", "export function Broken({ a }: { a: string ) {", "<<<>>>", STAT_CARD.slice(0, 200), "export { }", "export const X ="]) {
			expect(() => componentApi("components/x.tsx", source)).not.toThrow();
			expect(Array.isArray(componentApi("components/x.tsx", source).exports)).toBe(true);
		}
		expect(api("export function Broken({ a }: { a: string ) {")).toEqual([]);
	});

	test("mock generator components", () => {
		const files = generateMockScreens({ prompt: "A habit tracker", device: "mobile" }).changes;
		const tabBar = files.find((f) => f.path === "components/tab-bar.tsx")!;
		expect(propsSignature(one(tabBar.content!))).toBe("TabBar({ active?: number = 0 })");
		const statCard = files.find((f) => f.path === "components/stat-card.tsx")!;
		expect(propsSignature(one(statCard.content!))).toBe("StatCard({ label: string; value: string; change?: string; icon?: LucideIcon; className?: string })");
	});

	test("shadcn ui modules", () => {
		const read = (name: string) => readFileSync(join(import.meta.dir, `../../mainview/components/ui/${name}.tsx`), "utf8");
		const button = componentApi("button", read("button")).exports.find((e) => e.name === "Button")!;
		expect(button.variants.variant!.options).toContain("outline");
		expect(button.variants.size!.default).toBe("default");
		expect(prop(button, "asChild")).toEqual({ name: "asChild", type: { kind: "boolean" }, optional: true, default: false });
		expect(button.extendsElement).toBe("button");
		const card = componentApi("card", read("card")).exports.map((e) => e.name);
		expect(card).toEqual(["Card", "CardHeader", "CardFooter", "CardTitle", "CardAction", "CardDescription", "CardContent"]);
		const avatar = componentApi("avatar", read("avatar")).exports[0]!;
		expect(avatar.extendsElement).toBe("AvatarPrimitive.Root");
		expect(propsSignature(avatar)).toBe('Avatar({ size?: "default" | "sm" | "lg" = "default"; ...props: ComponentProps<typeof AvatarPrimitive.Root> })');
	});
});
