import { toast } from "sonner";
import { projectAssets } from "@/lib/render/assets";
import { api } from "@/lib/rpc";
import { UI_SOURCES } from "@/lib/ui-sources";
import { codeToCopy, localDependencies } from "../../../../shared/export/code";
import { packageName, viteProject } from "../../../../shared/export/vite-project";
import type { ExportContext } from "./export-menu";

/** The component open in the Components tab, else the first selected screen */
export function copyTarget(context: ExportContext): string | null {
	const target = context.selectedComponent ?? context.selected[0]?.file ?? null;

	return target && Object.hasOwn(context.files, target) ? target : null;
}

export function hasLocalImports(context: ExportContext) {
	const target = copyTarget(context);

	return target !== null && localDependencies(context.files, target).length > 0;
}

export async function copyCode(context: ExportContext, withComponents: boolean) {
	const target = copyTarget(context);

	if (!target) {
		toast("Select a screen or a component to copy its code");

		return;
	}

	try {
		await navigator.clipboard.writeText(codeToCopy(context.files, target, withComponents));
		const extra = withComponents ? localDependencies(context.files, target).length : 0;
		toast.success(
			`Copied ${target}`,
			extra ? { description: `With ${extra} imported ${extra === 1 ? "file" : "files"}` } : undefined,
		);
	} catch (error) {
		toast.error("Couldn't copy the code", { description: error instanceof Error ? error.message : String(error) });
	}
}

export async function exportViteProject(context: ExportContext) {
	try {
		const project = viteProject({
			name: context.projectName,
			frames: context.frames,
			files: context.files,
			theme: context.theme,
			uiSources: UI_SOURCES,
			assets: await projectAssets.base64(),
		});

		const parent = await api.pickExportFolder({});

		if (!parent) return;

		const { dir } = await api.writeExport({
			dir: parent,
			name: packageName(context.projectName),
			files: project.files,
			reveal: true,
		});

		toast.success("Exported a Vite project", { description: dir });

		for (const warning of project.warnings) toast.warning(warning);
	} catch (error) {
		toast.error("Couldn't export the project", { description: error instanceof Error ? error.message : String(error) });
	}
}
