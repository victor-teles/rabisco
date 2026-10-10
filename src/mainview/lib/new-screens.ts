import { boundsOf } from "./align";
import type { Size } from "./device-presets";
import { FRAME_SIZE, nextFrameX, uniqueScreenPath } from "../../shared/project";
import type { Device, Frame, ProjectFiles } from "../../shared/types";

type Point = { x: number; y: number };

/** A screen on the clipboard; `dx`/`dy` keep its place among the others copied with it */
export type ScreenCopy = Pick<Frame, "name" | "device" | "width" | "height"> & {
	source: string;
	dx: number;
	dy: number;
};

/** Only the new files and frames */
export type Placed = { files: ProjectFiles; frames: Frame[] };

const componentName = (name: string) =>
	name
		.replace(/[^A-Za-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.map((word) => word[0]!.toUpperCase() + word.slice(1))
		.join("")
		.replace(/^(\d)/, "Screen$1") || "Screen";

/** Sized for the device unless `size` is given */
export function blankScreen(name: string, device: Device, size: Size = FRAME_SIZE[device]): ScreenCopy {
	const source = `export default function ${componentName(name)}() {
	return <div className="flex min-h-full flex-col bg-background text-foreground" />;
}
`;

	return { name, device, width: size.width, height: size.height, source, dx: 0, dy: 0 };
}

export function copyScreens(frames: Frame[], files: ProjectFiles): ScreenCopy[] {
	const bounds = boundsOf(frames);

	if (!bounds) return [];

	return frames.map((frame) => ({
		name: frame.name,
		device: frame.device,
		width: frame.width,
		height: frame.height,
		source: files[frame.file] ?? "",
		dx: frame.x - bounds.x,
		dy: frame.y - bounds.y,
	}));
}

/** Pasted TSX with a default export becomes a screen named after its component */
export function screenFromCode(text: string, device: Device): ScreenCopy | null {
	if (!/^\s*export\s+default\b/m.test(text)) return null;
	const component = /export\s+default\s+function\s+([A-Za-z_$][\w$]*)/.exec(text)?.[1];
	const words = component?.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase() ?? "pasted screen";

	return { ...blankScreen(words[0]!.toUpperCase() + words.slice(1), device), source: text };
}

/** The top-left that centers the copies, as laid out together, on `point` */
export function centeredOn(copies: ScreenCopy[], point: Point): Point {
	const width = Math.max(0, ...copies.map((copy) => copy.dx + copy.width));
	const height = Math.max(0, ...copies.map((copy) => copy.dy + copy.height));

	return { x: point.x - width / 2, y: point.y - height / 2 };
}

/** Adds the copies with their top-left at `at`, else to the right of every frame */
export function placeScreens(files: ProjectFiles, frames: Frame[], copies: ScreenCopy[], at?: Point): Placed {
	const origin = at ?? { x: nextFrameX(frames), y: frames.length ? Math.min(...frames.map((frame) => frame.y)) : 0 };
	const taken = new Set(Object.keys(files));

	const added = copies.map((copy): Frame => {
		const file = uniqueScreenPath(copy.name, taken);
		taken.add(file);

		return {
			file,
			name: copy.name,
			device: copy.device,
			x: Math.round(origin.x + copy.dx),
			y: Math.round(origin.y + copy.dy),
			width: copy.width,
			height: copy.height,
		};
	});

	return { files: Object.fromEntries(added.map((frame, i) => [frame.file, copies[i]!.source])), frames: added };
}

/** The last copy, so a paste of the same text keeps names, sizes and layout */
let clipboard: { text: string; screens: ScreenCopy[] } | null = null;

/** The system clipboard gets the code, so it pastes into an editor too */
export function writeScreens(screens: ScreenCopy[]) {
	const text = screens.map((screen) => screen.source).join("\n\n");
	clipboard = { text, screens };

	return navigator.clipboard.writeText(text).catch(() => undefined);
}

/** Screens copied here, else a screen from TSX on the system clipboard; falls back to the last copy if it can't be read */
export async function readScreens(device: Device): Promise<ScreenCopy[]> {
	const text = await navigator.clipboard.readText().catch(() => null);

	if (clipboard && (text === null || text === clipboard.text)) return clipboard.screens;
	const pasted = text === null ? null : screenFromCode(text, device);

	return pasted ? [pasted] : [];
}
