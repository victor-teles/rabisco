import { describe, expect, test } from "bun:test";
import { assetUsages, fontUsages, iconUsages } from "./asset-usage";
import { fontFamilies } from "./fonts";

const files = {
	"screens/home.tsx": `import { Star, HeartIcon } from "lucide-react";
export default function Home() {
	return (
		<div className="font-display bg-[url(/images/hero.png)]">
			<img src="/images/logo.png" alt="" />
			<img src="./images/logo.png?v=2" alt="" />
			<Star /><Star /><HeartIcon />
		</div>
	);
}`,
	"components/card.tsx": `import { Star } from "lucide-react";
export function Card() {
	return <div className="font-display"><img src="/images/logo.png" /><Star /></div>;
}`,
	"PRODUCT.md": "/images/logo.png",
};

describe("assetUsages", () => {
	test("counts each reference in screens and components", () => {
		const usages = assetUsages(files, ["/images/logo.png", "/images/hero.png", "/images/unused.png"]);
		expect(usages.get("/images/logo.png")).toEqual({ count: 3, paths: ["screens/home.tsx", "components/card.tsx"] });
		expect(usages.get("/images/hero.png")?.count).toBe(1);
		expect(usages.has("/images/unused.png")).toBe(false);
	});
});

describe("iconUsages", () => {
	test("counts lucide elements by icon name", () => {
		expect(iconUsages(files)).toEqual([
			{ name: "Star", count: 3, paths: ["screens/home.tsx", "components/card.tsx"] },
			{ name: "Heart", count: 1, paths: ["screens/home.tsx"] },
		]);
	});
});

describe("fontUsages", () => {
	test("counts the uses of the tokens that name the family", () => {
		const families = fontFamilies(["/fonts/brand-sans.woff2", "/fonts/other.woff2"]);
		const tokens = { light: { "font-display": '"Brand Sans", sans-serif' }, dark: {} };
		const usages = fontUsages(files, tokens, families);
		expect(usages.get("brand-sans")).toEqual({
			count: 2,
			paths: ["screens/home.tsx", "components/card.tsx"],
			tokens: ["font-display"],
		});
		expect(usages.get("other")?.count).toBe(0);
	});
});
