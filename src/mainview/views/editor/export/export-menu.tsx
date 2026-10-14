import { memo } from "react";
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
import type { DesignTokens } from "../../../../shared/context/tokens";
import { imageTargets } from "../../../../shared/export/targets";
import { isComponentFile } from "../../../../shared/project";
import type { Frame, ProjectFiles } from "../../../../shared/types";
import { NEXT } from "../../../../shared/export/next-project";
import { REACT_ROUTER } from "../../../../shared/export/react-router-project";
import { VITE } from "../../../../shared/export/vite-project";
import {
	copyCode,
	exportComponentLibrary,
	exportHtml,
	exportProject,
	exportTokens,
	hasLocalImports,
} from "./code-export";
import { exportFlowPdf, exportImages } from "./image-export";
import { copyToFigma } from "./figma-export";

export type ExportContext = {
	projectPath: string;
	projectName: string;
	frames: Frame[];
	files: ProjectFiles;
	/** The applied DESIGN.md tokens; exports look like the canvas */
	theme: DesignTokens;
	/** In canvas order */
	selected: Frame[];
	selectedComponent: string | null;
	/** So a git commit includes the current layout */
	flushCanvas: () => Promise<void>;
	/** A git pull may have replaced them */
	reloadFromDisk: () => Promise<void>;
	/** A reload from disk would clear it */
	hasUndoHistory?: boolean;
};

export const ExportMenu = memo(function ExportMenu(props: ExportContext) {
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
				<DropdownMenuLabel>Code</DropdownMenuLabel>
				<DropdownMenuItem onSelect={() => void copyCode(props, false)}>Copy code</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void copyCode(props, true)} disabled={!hasLocalImports(props)}>
					Copy with components
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void exportProject(props, VITE)} disabled={frames.length === 0}>
					Vite + React project…
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void exportProject(props, NEXT)} disabled={frames.length === 0}>
					Next.js project…
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void exportProject(props, REACT_ROUTER)} disabled={frames.length === 0}>
					React Router project…
				</DropdownMenuItem>
				<DropdownMenuItem
					onSelect={() => void exportComponentLibrary(props)}
					disabled={!Object.keys(props.files).some(isComponentFile)}
				>
					Component library…
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void exportHtml(props)} disabled={props.selected.length === 0}>
					HTML and CSS of the screen…
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void exportTokens(props)}>Design tokens…</DropdownMenuItem>
				<DropdownMenuSeparator />
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
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Figma</DropdownMenuLabel>
				<DropdownMenuItem
					onSelect={() => void copyToFigma({ ...props, selected: imageTargets(frames, props.selected, props.files) })}
					disabled={frames.length === 0}
				>
					Copy to Figma
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
});
