import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { readRepoInfo } from "./repo-sync";
import { tempDir } from "./test-utils";

function repo(files: Record<string, string>) {
	const dir = tempDir();

	for (const [path, content] of Object.entries(files)) {
		mkdirSync(join(dir, path, ".."), { recursive: true });
		writeFileSync(join(dir, path), content);
	}

	return dir;
}

describe("readRepoInfo", () => {
	test("reads the shadcn aliases through tsconfig paths, with comments", () => {
		const dir = repo({
			"components.json": JSON.stringify({
				aliases: { components: "~/components", ui: "~/components/ui", utils: "~/lib/utils" },
			}),
			"tsconfig.json": `{
	// Paths
	"compilerOptions": { "paths": { "~/*": ["./app/*"] }, /* trailing */ },
	"$schema": "https://json.schemastore.org/tsconfig",
}`,
			"app/components/ui/button.tsx": "",
			"app/components/ui/uai/message.tsx": "",
			"app/home.tsx": "",
			"package.json": JSON.stringify({ dependencies: { react: "19" }, devDependencies: { vite: "8" } }),
		});

		const info = readRepoInfo(dir, ["app/home.tsx", "app/components/card.tsx"]);

		expect(info.existing).toEqual(["app/home.tsx"]);
		expect(info.uiAlias).toBe("~/components/ui");
		expect(info.utilsAlias).toBe("~/lib/utils");
		expect(info.uiModules?.sort()).toEqual(["button", "uai/message"]);
		expect(info.packages).toEqual(["react", "vite"]);
		expect(info.componentsDir).toBe("app/components");
	});

	test("falls back to src/components without shadcn", () => {
		const dir = repo({ "src/main.tsx": "" });
		const info = readRepoInfo(dir, []);

		expect(info.uiAlias).toBeNull();
		expect(info.uiModules).toEqual([]);
		expect(info.packages).toBeNull();
		expect(info.componentsDir).toBe("src/components");
	});

	test("refuses paths outside the repository", () => {
		expect(() => readRepoInfo(repo({}), ["../x.tsx"])).toThrow();
	});
});
