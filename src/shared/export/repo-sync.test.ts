import { describe, expect, test } from "bun:test";
import { defaultTarget, relativeSpecifier, repoPathProblem, repoSync, repoSyncPaths } from "./repo-sync";

const files = {
	"screens/home.tsx": `import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Bell } from "lucide-react";
import { motion } from "motion/react";
import { StatCard } from "../components/stat-card";

export default function Home() {
	return <StatCard />;
}
`,
	"components/stat-card.tsx": `import { Card } from "@/components/ui/card";
import { Trend } from "./trend";

export function StatCard() {
	return <Card><Trend /></Card>;
}
`,
	"components/trend.tsx": "export function Trend() {\n\treturn null;\n}\n",
	"components/unused.tsx": "export function Unused() {\n\treturn null;\n}\n",
};

describe("relativeSpecifier", () => {
	test("walks up to the shared folder", () => {
		expect(relativeSpecifier("src/app/home/page.tsx", "src/components/card.tsx")).toBe("../../components/card");
		expect(relativeSpecifier("src/components/home.tsx", "src/components/card.tsx")).toBe("./card");
		expect(relativeSpecifier("home.tsx", "components/card.ts")).toBe("./components/card");
	});
});

describe("repoSync", () => {
	test("writes the screen and the components it imports, and points the imports at them", () => {
		const sync = repoSync({
			files,
			screen: "screens/home.tsx",
			target: "src/app/home.tsx",
			componentsDir: "src/ui-kit",
		});

		expect(sync.files.map((file) => file.path)).toEqual([
			"src/app/home.tsx",
			"src/ui-kit/stat-card.tsx",
			"src/ui-kit/trend.tsx",
		]);

		expect(sync.files[0]!.content).toContain(`import { StatCard } from "../ui-kit/stat-card";`);
		expect(sync.files[1]!.content).toContain(`import { Trend } from "./trend";`);
		expect(sync.ui).toEqual(["button", "card"]);
		expect(sync.packages).toEqual(["lucide-react", "motion"]);
	});

	test("uses the repository's shadcn aliases", () => {
		const sync = repoSync({
			files,
			screen: "screens/home.tsx",
			target: "./app/home.tsx",
			componentsDir: "app/components/",
			uiAlias: "~/components/ui/",
			utilsAlias: "~/lib/cn",
		});

		expect(sync.files[0]!.path).toBe("app/home.tsx");
		expect(sync.files[0]!.content).toContain(`from "~/components/ui/button"`);
		expect(sync.files[0]!.content).toContain(`from "~/lib/cn"`);
		expect(sync.files[1]!.content).toContain(`from "~/components/ui/card"`);
	});

	test("lists the paths it writes", () => {
		expect(repoSyncPaths(files, "screens/home.tsx", "src/home.tsx", "src/components")).toEqual([
			"src/home.tsx",
			"src/components/stat-card.tsx",
			"src/components/trend.tsx",
		]);
	});
});

describe("paths", () => {
	test("keeps writes inside the repository", () => {
		expect(repoPathProblem("src/home.tsx", "file")).toBeNull();
		expect(repoPathProblem("", "folder")).toBeNull();
		expect(repoPathProblem("../home.tsx", "file")).not.toBeNull();
		expect(repoPathProblem("/tmp/home.tsx", "file")).not.toBeNull();
		expect(repoPathProblem("src/home.ts", "file")).not.toBeNull();
		expect(repoPathProblem("src/../../x", "folder")).not.toBeNull();
	});

	test("defaults the screen into the components folder", () => {
		expect(defaultTarget("screens/home.tsx", "src/components/")).toBe("src/components/home.tsx");
		expect(defaultTarget("screens/home.tsx", "")).toBe("home.tsx");
	});
});
