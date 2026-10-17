import { setLink, type ElementRef } from "../prototype/links";
import { FRAME_SIZE, isScreenFile } from "../project";
import type { Device, FileChange, Frame, ProjectFiles } from "../types";
import { isAlternate } from "../variations";

export const SCREEN_STATES = ["empty", "loading", "error", "filled"] as const;

export type ScreenState = (typeof SCREEN_STATES)[number];

export const STATE_LABELS: Record<ScreenState, string> = {
	empty: "Empty",
	loading: "Loading",
	error: "Error",
	filled: "Filled",
};

const STATE_DIRECTIONS: Record<ScreenState, string> = {
	empty:
		"the empty state: nothing has been added yet. Replace the lists, tables and charts with one calm message: a short title, one line of help and the action that fills it",
	loading:
		"the loading state: the data is on its way. Keep the bars and headings, and draw the content as bg-muted animate-pulse skeletons in the shape of the real rows, cards and charts",
	error:
		"the error state: the data failed to load. Keep the bars and headings, and put a clear message where the content goes: what happened, in plain words, and how to fix it, with a Try again button",
	filled:
		"the filled state: a busy day with plenty of data. Fill every list, table and chart with realistic, specific content, more rows than now, with long names and big numbers where the product has them",
};

export function statePrompt(state: ScreenState) {
	return [
		`Make ${STATE_DIRECTIONS[state]}.`,
		"Keep everything else of this screen as it is: the layout, the navigation, the components and the classes.",
		"Write it to the same path. Rabisco saves it as a new alternate and keeps the original as it is.",
	].join("\n");
}

const DEVICE_LAYOUTS: Record<Device, string> = {
	mobile: "one column, a top bar and a bottom tab bar, controls at least 44px tall",
	tablet: "two columns where the content allows, with a side or top navigation",
	desktop:
		"a sidebar or a top nav, a content area capped in width, and the extra width used for columns and side panels",
};

export function responsivePrompt(from: Device, to: Device) {
	const { width, height } = FRAME_SIZE[to];

	return [
		`Make the ${to} version of this ${from} screen, for a ${width}×${height} frame: ${DEVICE_LAYOUTS[to]}.`,
		"Keep the same content, copy, actions, components and theme classes. Change only the layout and what the size calls for.",
		"Write it to the same path. Rabisco saves it as a new alternate and keeps the original as it is.",
	].join("\n");
}

export const DEVICES: readonly Device[] = ["mobile", "tablet", "desktop"];

export const DEVICE_LABELS: Record<Device, string> = { mobile: "Mobile", tablet: "Tablet", desktop: "Desktop" };

export type NextScreen = {
	element: string;
	from: string;
	fromPath: string;
	description: string;
};

export function nextScreenPrompt({ element, from, fromPath, description }: NextScreen) {
	return [
		`Make the screen that ${element} on ${from} (${fromPath}) opens: ${description.trim() || "the natural next step"}.`,
		`Match ${fromPath} exactly in style: the same navigation, page padding, type scale, components and theme classes, so the two read as one app. Reuse its components and its copy where they carry over.`,
		`Give it a way back: a back button or the same navigation, with data-link-to="back" on the back control.`,
		`Write one new screen. Don't change ${fromPath}; Rabisco links the element to the new screen.`,
	].join("\n");
}

export const nextScreenNote = (element: string, from: string, description: string) =>
	`Next screen from ${element} on ${from}${description.trim() ? `: ${description.trim()}` : ""}`;

export const SHUFFLE_PROMPT = [
	"Shuffle the content of this screen: new names, numbers, dates, copy and data, all different from now.",
	"Take them from PRODUCT.md when it is given (the product, its audience and its voice), and keep them realistic and specific: plausible values in the same formats, as many rows as now.",
	"Keep the layout, the components, the icons and every class as they are. Change only text, numbers and the props that hold content.",
].join("\n");

export const DARK_PASS_PROMPT = [
	"This screen renders in dark mode with the dark tokens of DESIGN.md. The design check found the problems below there.",
	"Fix them so the screen reads well in both light and dark: use theme classes (bg-background, bg-card, text-foreground, text-muted-foreground, border, bg-primary and the custom tokens) instead of fixed palette colors, and add a dark: class where a fixed color must stay.",
	"Keep the layout, the content and the light look as they are.",
].join("\n");

export function everyScreenPrompt(prompt: string, screen: string, count: number) {
	return [
		prompt.trim(),
		"",
		`This change applies to every screen of the project (${count} screens). This run changes ${screen} only; other runs change the other screens the same way.`,
		"Apply the change wherever it fits this screen and leave the rest as it is. Don't change project components: other screens use them too. When nothing on this screen matches, write nothing.",
	].join("\n");
}

export function nextScreenLink(files: ProjectFiles, link: ElementRef, created: readonly string[]): FileChange | null {
	const target = created.find((path) => isScreenFile(path) && !isAlternate(path) && path !== link.file);
	const source = files[link.file];

	if (!target || source === undefined) return null;
	const content = setLink(source, link.start, target);

	return content === null || content === source ? null : { path: link.file, content };
}

export const everyScreen = (frames: readonly Frame[], files: ProjectFiles) => [
	...new Set(
		frames.flatMap((frame) =>
			isScreenFile(frame.file) && !isAlternate(frame.file) && frame.file in files ? [frame.file] : [],
		),
	),
];

export const everyScreenNote = (prompt: string) => `Every screen: ${prompt.trim()}`;
