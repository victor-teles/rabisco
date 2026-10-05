import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Frame, ProjectFiles } from "../../../../shared/types";
import { copyCode, exportViteProject, hasLocalImports } from "./code-export";
import { exportFlowPdf, exportImages } from "./image-export";

/** What every export needs from the editor. */
export type ExportContext = {
	projectPath: string;
	projectName: string;
	frames: Frame[];
	files: ProjectFiles;
	/** Selected screens, in canvas order */
	selected: Frame[];
	/** The component open in the Components tab, if any (`components/*.tsx`) */
	selectedComponent: string | null;
	/** Writes a pending canvas save, so a git commit includes the current layout */
	flushCanvas: () => Promise<void>;
	/** Reads the canvas and files again after a git pull replaced them */
	reloadFromDisk: () => Promise<void>;
};

/** The title bar's Export button (Phase 7): code, a runnable project, images and the flow PDF. */
export function ExportMenu(props: ExportContext) {
	const { frames } = props;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button size="sm">
					<Download />
					Export
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				{/* Code (copy as code, Vite project) */}
				<DropdownMenuLabel>Code</DropdownMenuLabel>
				<DropdownMenuItem onSelect={() => void copyCode(props, false)}>Copy code</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void copyCode(props, true)} disabled={!hasLocalImports(props)}>
					Copy with components
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void exportViteProject(props)} disabled={frames.length === 0}>
					Vite + React project…
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				{/* Images (PNG, SVG, flow PDF) */}
				<DropdownMenuLabel>Images</DropdownMenuLabel>
				<DropdownMenuItem onSelect={() => void exportImages("png", props)} disabled={frames.length === 0}>
					PNG…
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void exportImages("svg", props)} disabled={frames.length === 0}>
					SVG…
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void exportFlowPdf(props)} disabled={frames.length === 0}>
					PDF of the flow…
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
