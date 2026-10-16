import { describe, expect, test } from "bun:test";
import { compileTsx } from "../bun/test-utils";
import {
	findPlaceholders,
	placeholderAspect,
	placeholderDescription,
	placeholderImageRequest,
	replacePlaceholder,
	replacePlaceholders,
} from "./placeholder-images";

const screen = `import { Placeholder } from "@/components/ui/placeholder";
import { Button } from "@/components/ui/button";

export default function Menu() {
	return (
		<div>
			<Placeholder kind="photo" subject="food" seed="brunch" className="aspect-[4/3] w-full rounded-lg" />
			<Placeholder kind="avatar" seed="ana" label="Ana's photo" />
			<Placeholder kind="chart" subject="bar" />
			<Button>Order</Button>
		</div>
	);
}
`;

describe("findPlaceholders", () => {
	test("finds photos, avatars, illustrations and maps, not charts", () => {
		const uses = findPlaceholders("screens/menu.tsx", screen);
		expect(uses.map((use) => use.kind)).toEqual(["photo", "avatar"]);
		expect(uses[0]).toMatchObject({ subject: "food", seed: "brunch", className: "aspect-[4/3] w-full rounded-lg" });
		expect(findPlaceholders("screens/a.tsx", "export default () => <Placeholder />")).toEqual([]);
	});

	test("picks an aspect from the classes", () => {
		const [photo, avatar] = findPlaceholders("screens/menu.tsx", screen);
		expect(placeholderAspect(photo!)).toBe("landscape");
		expect(placeholderAspect(avatar!)).toBe("square");
		expect(placeholderAspect({ ...photo!, className: "aspect-[3/4]" })).toBe("portrait");
	});

	test("describes the image for the image model", () => {
		const [photo] = findPlaceholders("screens/menu.tsx", screen);

		const request = placeholderImageRequest(
			photo!,
			{ screen: "Menu", product: "# Brunchy\n\nA brunch spot app" },
			"warm",
		);

		expect(request.aspect).toBe("landscape");
		expect(request.prompt).toContain("photograph. Subject: food, brunch.");
		expect(request.prompt).toContain('"Menu" screen of an app: A brunch spot app');
		expect(request.prompt).toContain("warm");
	});
});

describe("replacePlaceholder", () => {
	test("writes an img with the size classes and keeps the import while other uses remain", () => {
		const [photo] = findPlaceholders("screens/menu.tsx", screen);
		const next = replacePlaceholder(screen, photo!.start, "/images/food-brunch.png", "Food photo")!;

		expect(next).toContain(
			'<img src="/images/food-brunch.png" alt="Food photo" className="aspect-[4/3] w-full rounded-lg object-cover" />',
		);
		expect(next).toContain('import { Placeholder } from "@/components/ui/placeholder";');
		expect(() => compileTsx(next)).not.toThrow();
	});

	test("drops the import when the last use goes", () => {
		const uses = findPlaceholders("screens/menu.tsx", screen);
		const images = uses.map((use) => ({ use, src: `/images/${use.kind}.png` }));

		const withoutChart = {
			"screens/menu.tsx": screen.replace('<Placeholder kind="chart" subject="bar" />\n\t\t\t', ""),
		};

		const { files, replaced } = replacePlaceholders(withoutChart, images);

		expect(replaced).toBe(2);
		expect(files["screens/menu.tsx"]).not.toContain("placeholder");
		expect(files["screens/menu.tsx"]).toContain(`alt="Ana's photo"`);
		expect(files["screens/menu.tsx"]).toContain('className="size-10 shrink-0 rounded-full object-cover"');
	});

	test("finds a placeholder that moved since the image was asked for", () => {
		const [photo] = findPlaceholders("screens/menu.tsx", screen);
		const moved = { "screens/menu.tsx": screen.replace("<div>", '<div className="grid gap-4">') };
		const { replaced } = replacePlaceholders(moved, [{ use: photo!, src: "/images/a.png" }]);
		expect(replaced).toBe(1);
		expect(replacePlaceholders({}, [{ use: photo!, src: "/images/a.png" }]).replaced).toBe(0);
	});
});

test("placeholderDescription names the image for the panel and its alt text", () => {
	const [photo, avatar] = findPlaceholders("screens/menu.tsx", screen);

	expect(placeholderDescription(photo!)).toBe("Food photo: brunch");
	expect(placeholderDescription(avatar!)).toBe("Ana's photo");
});
