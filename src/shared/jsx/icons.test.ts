import { describe, expect, test } from "bun:test";
import { iconAt, iconBase, swapIcon } from "./icons";
import { parseFile } from "./tree";

const at = (source: string, needle: string) => {
	const index = source.indexOf(needle);

	if (index < 0) throw new Error(`missing ${needle}`);

	return index;
};

const screen = (imports: string, jsx: string) =>
	`${imports}\n\nexport default function Screen() {\n\treturn (\n\t\t${jsx}\n\t);\n}\n`;

describe("iconAt", () => {
	test("a named lucide import used as an element", () => {
		const source = screen(`import { Star, Home as House } from "lucide-react";`, `<div><Star /><House /></div>`);
		expect(iconAt(source, at(source, "<Star"))).toEqual({ local: "Star", imported: "Star" });
		expect(iconAt(source, at(source, "<House"))).toEqual({ local: "House", imported: "Home" });
	});

	test("other elements are not icons", () => {
		const source = screen(
			`import { Button } from "@/components/ui/button";\nimport { Star } from "lucide-react";`,
			`<div><Button /><span /></div>`,
		);

		expect(iconAt(source, at(source, "<Button"))).toBeNull();
		expect(iconAt(source, at(source, "<span"))).toBeNull();
		expect(iconAt(source, at(source, "<div"))).toBeNull();
	});

	test("iconBase", () => {
		expect(iconBase("Star")).toBe("Star");
		expect(iconBase("StarIcon")).toBe("Star");
		expect(iconBase("LucideStar")).toBe("Star");
		expect(iconBase("Icon")).toBe("Icon");
	});
});

describe("swapIcon", () => {
	test("renames the element and swaps the import", () => {
		const source = screen(
			`import { useState } from "react";\nimport { Star, Search } from "lucide-react";`,
			`<div><Star className="size-4" /><Search /></div>`,
		);

		const next = swapIcon(source, at(source, "<Star"), "Heart");
		expect(next).toBe(
			screen(
				`import { useState } from "react";\nimport { Search, Heart } from "lucide-react";`,
				`<div><Heart className="size-4" /><Search /></div>`,
			),
		);
		expect(parseFile(next!).ok).toBe(true);
	});

	test("keeps the old import while another element uses it", () => {
		const source = screen(`import { Star } from "lucide-react";`, `<div><Star /><Star /></div>`);
		expect(swapIcon(source, at(source, "<Star"), "Heart")).toBe(
			screen(`import { Star, Heart } from "lucide-react";`, `<div><Heart /><Star /></div>`),
		);
	});

	test("renames the closing tag too", () => {
		const source = screen(`import { Star } from "lucide-react";`, `<Star>\n\t\t\t<title>Fav</title>\n\t\t</Star>`);
		expect(swapIcon(source, at(source, "<Star"), "Heart")).toBe(
			screen(`import { Heart } from "lucide-react";`, `<Heart>\n\t\t\t<title>Fav</title>\n\t\t</Heart>`),
		);
	});

	test("reuses an icon that is already imported", () => {
		const source = screen(`import { Star, Heart } from "lucide-react";`, `<div><Star /><Heart /></div>`);
		expect(swapIcon(source, at(source, "<Star"), "Heart")).toBe(
			screen(`import { Heart } from "lucide-react";`, `<div><Heart /><Heart /></div>`),
		);
	});

	test("uses the Icon alias when the name is taken", () => {
		const source = screen(
			`import { Link } from "@/components/link";\nimport { Star } from "lucide-react";`,
			`<div><Star /><Link /></div>`,
		);

		expect(swapIcon(source, at(source, "<Star"), "Link")).toBe(
			screen(
				`import { Link } from "@/components/link";\nimport { LinkIcon } from "lucide-react";`,
				`<div><LinkIcon /><Link /></div>`,
			),
		);
		const local = `function Badge() {\n\treturn null;\n}\n${screen(`import { Star } from "lucide-react";`, `<Star />`)}`;
		expect(swapIcon(local, at(local, "<Star"), "Badge")).toContain("<BadgeIcon />");
	});

	test("the same icon leaves the source alone; non-icons and bad names are refused", () => {
		const source = screen(`import { Star } from "lucide-react";`, `<div><Star /></div>`);
		expect(swapIcon(source, at(source, "<Star"), "StarIcon")).toBe(source);
		expect(swapIcon(source, at(source, "<div"), "Heart")).toBeNull();
		expect(swapIcon(source, at(source, "<Star"), "heart")).toBeNull();
	});
});
