import { expect, test } from "bun:test";
import { componentLibrary } from "./component-library";
import { exportFixture } from "./export-fixture";

const input = exportFixture();

const project = componentLibrary(input);

const out = Object.fromEntries(project.files.map((file) => [file.path, file.content]));

test("every component export gets a preview page, and variants when it has some", () => {
	expect(
		Object.keys(out)
			.filter((path) => path.startsWith("src/previews/"))
			.sort(),
	).toEqual([
		"src/previews/profile-row.tsx",
		"src/previews/sidebar-nav.tsx",
		"src/previews/stat-card.tsx",
		"src/previews/tab-bar.tsx",
	]);
	expect(out["src/previews/profile-row.tsx"]).toContain('import { ProfileRow } from "../components/profile-row";');
	expect(out["src/previews/profile-row.tsx"]).toContain('<ProfileRow name={"Name"} role={"Role"} />');
	expect(project.warnings).toEqual([]);
});

test("the gallery lists each component with its file, props and the screens that use it", () => {
	const app = out["src/App.tsx"]!;

	expect(app).toContain('import StatCardPreview from "./previews/stat-card";');
	expect(app).toContain('file: "src/components/stat-card.tsx"');
	expect(app).toContain('screens: ["dashboard","details","home","landing"]');
	expect(app).toContain('signature: "ProfileRow({ name: string; role: string; className?: string })"');
	expect(app).toContain("class PreviewBoundary");
});

test("ships the components and their UI kit, but no screens", () => {
	expect(out["src/components/stat-card.tsx"]).toBe(input.files["components/stat-card.tsx"]!);
	expect(out["src/components/ui/badge.tsx"]).toBeString();
	expect(Object.keys(out).some((path) => path.startsWith("src/screens/"))).toBe(false);
	expect(out["README.md"]).toContain("component library");
	expect(out["README.md"]).not.toContain("## Prototype links");
});

test("variant grids come from cva variants", () => {
	const chip = `import { cva, type VariantProps } from "class-variance-authority";

const chip = cva("rounded-full px-2", { variants: { tone: { neutral: "bg-muted", brand: "bg-primary" } } });

export function Chip({ tone, label }: VariantProps<typeof chip> & { label: string }) {
	return <span className={chip({ tone })}>{label}</span>;
}
`;

	const files = componentLibrary({ ...input, files: { ...input.files, "components/chip.tsx": chip } }).files;
	const variants = files.find((file) => file.path === "src/previews/chip-variants.tsx")?.content;

	expect(variants).toContain('<Chip label={"Label"} tone={"brand"} />');
	expect(files.find((file) => file.path === "src/App.tsx")?.content).toContain("Variants: ChipVariants");
});

test("needs a component", () => {
	expect(() => componentLibrary({ ...input, files: { "screens/a.tsx": "export default function A() {}" } })).toThrow(
		"There are no components to export",
	);
});
