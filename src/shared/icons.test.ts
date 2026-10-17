import { describe, expect, test } from "bun:test";
import { iconBase, iconExport, iconFile, iconPackOf, iconSpec, isFilledTabler, parseIconSpec } from "./icons";

describe("icon packs", () => {
	test("iconBase strips each pack's affixes", () => {
		expect(iconBase("lucide", "Star")).toBe("Star");
		expect(iconBase("lucide", "StarIcon")).toBe("Star");
		expect(iconBase("lucide", "LucideStar")).toBe("Star");
		expect(iconBase("lucide", "Icon")).toBe("Icon");
		expect(iconBase("tabler", "IconStarFilled")).toBe("StarFilled");
		expect(iconBase("phosphor", "HouseIcon")).toBe("House");
		expect(iconExport("tabler", "Star")).toBe("IconStar");
		expect(iconExport("phosphor", "House")).toBe("House");
	});

	test("specs name the pack, except lucide's for older snapshots", () => {
		expect(iconPackOf("@tabler/icons-react")).toBe("tabler");
		expect(iconPackOf("react")).toBeNull();
		expect(iconSpec("lucide-react", "Star")).toBe("Star");
		expect(iconSpec("@phosphor-icons/react", "House")).toBe("@phosphor-icons/react:House");
		expect(iconSpec("react", "Star")).toBeNull();
		expect(parseIconSpec("@tabler/icons-react:IconStar")).toEqual({ pack: "tabler", name: "IconStar" });
		expect(parseIconSpec("Star")).toEqual({ pack: "lucide", name: "Star" });
		expect(parseIconSpec("left-pad:Star")).toBeNull();
	});

	test("iconFile: one script per icon, both Tabler styles and both Phosphor names share it", () => {
		expect(iconFile("Home")).toBe("home");
		expect(iconFile("ArrowUpRight")).toBe("arrow-up-right");
		expect(iconFile("@tabler/icons-react:IconHome")).toBe("tabler/home");
		expect(iconFile("@tabler/icons-react:IconHomeFilled")).toBe("tabler/home");
		expect(iconFile("@tabler/icons-react:IconAB2")).toBe("tabler/a-b2");
		expect(iconFile("@tabler/icons-react:Home")).toBeNull();
		expect(iconFile("@phosphor-icons/react:HouseIcon")).toBe("phosphor/house");
		expect(iconFile("@phosphor-icons/react:ArrowUpRight")).toBe("phosphor/arrow-up-right");
		expect(iconFile("@phosphor-icons/react:../x")).toBeNull();
		expect(isFilledTabler("IconHomeFilled")).toBe(true);
		expect(isFilledTabler("IconHome")).toBe(false);
	});
});
