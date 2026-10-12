import { toast } from "sonner";
import type { ChangeOptions } from "@/hooks/use-project";
import type { Action } from "@/lib/actions";
import { systemPaste, type PasteData } from "@/lib/clipboard";
import { figmaImport } from "@/lib/figma-import";
import { appliedTheme, htmlScreen } from "@/lib/html-import";
import { DEVICE_PRESETS, deviceForSize, type DevicePreset, type Size } from "@/lib/device-presets";
import type { Snapshot } from "@/lib/history";
import {
	blankScreen,
	centeredOn,
	importedScreen,
	copyScreens,
	placeScreens,
	readScreens,
	writeScreens,
	type ScreenCopy,
} from "@/lib/new-screens";
import type { DesignTokens } from "../../../shared/context/tokens";
import { hasFigmaData } from "../../../shared/import/figma/clipboard";
import { treeToTsx } from "../../../shared/import/to-tsx";
import type { UrlCapture } from "../../../shared/import/url-capture";
import { isScreenFile } from "../../../shared/project";
import type { Device, Frame } from "../../../shared/types";
import { isAlternate } from "../../../shared/variations";
import { askCustomSize } from "./custom-size-dialog";
import { askPageImport } from "./import-page-dialog";
import { NEW_SCREEN_CODE } from "./shortcuts";

type Point = { x: number; y: number };

const FIGMA_SCREEN_GAP = 80;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export const presetActionId = (preset: DevicePreset) => `new-screen-${preset.id}`;

export type ScreenActionsContext = {
	/** The latest project, read when an action runs: paste waits for the clipboard */
	current: () => Snapshot | null;
	selected: Frame[];
	device: Device;
	busy: boolean;
	/** For "Vary this" */
	variations: number;
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	rename: (file: string) => void;
	vary: (target: string, direction: string, count: number) => void;
	pick: (file: string) => void;
	play: (file: string) => void;
	startComment: (point: Point) => void;
	commentTool: () => void;
	/** New screens away from a right-click are brought into view */
	reveal: (frames: Frame[]) => void;
	/** Where ⌘V pastes: the pointer, when it is over the canvas */
	pointer: () => Point | null;
	pasteImages: (at: Point | null, paste: PasteData) => Promise<boolean>;
	projectPath: string;
	importTokens: (tokens: DesignTokens) => void;
};

/** Screen and canvas actions; with `point` (a right-click on the canvas) new screens and comments land there */
export function screenActions(context: ScreenActionsContext, point?: Point): Action[] {
	const { selected, busy, device } = context;
	const single = selected.length === 1 ? selected[0]! : null;
	const screen = single && isScreenFile(single.file) ? single : null;

	/** One undo step that selects the new screens; their top-left goes at `at` */
	const add = (copies: ScreenCopy[], at = point) => {
		const current = context.current();

		if (!current) return [];
		const placed = placeScreens(current.files, current.frames, copies, at);
		const added = placed.frames.map((frame) => frame.file);

		context.change(
			(snapshot) => ({
				...snapshot,
				files: { ...snapshot.files, ...placed.files },
				frames: [...snapshot.frames, ...placed.frames],
			}),
			{ select: added },
		);

		if (!at) context.reveal(placed.frames);

		return placed.frames;
	};

	/** Selects the new screen and starts naming it */
	const addBlank = (screenDevice: Device, size?: Size) => {
		const [frame] = add([blankScreen("Untitled", screenDevice, size)]);

		if (frame) context.rename(frame.file);
	};

	/** The screens are one undo step; variables that aren't tokens yet go into DESIGN.md as a second one */
	const pasteFigma = async (html: string, under: Point | null) => {
		const result = await figmaImport(html, context.current()?.theme).catch((error: Error) => error);

		if (result instanceof Error) {
			toast.error("Couldn't paste from Figma", { description: result.message });

			return;
		}

		const copies = result.screens.map((screen) => importedScreen(screen, deviceForSize(screen)));

		if (!copies.length) {
			toast("Nothing to paste", { description: "Copy a frame or layers in Figma first." });

			return;
		}

		let dx = 0;

		for (const copy of copies) {
			copy.dx = dx;
			dx += copy.width + FIGMA_SCREEN_GAP;
		}

		add(copies, under ? centeredOn(copies, under) : undefined);
		const added = Object.keys(result.added).length;

		if (added) context.importTokens({ light: result.added, dark: {} });

		const notes = [
			added ? `Added ${plural(added, "Figma variable")} to DESIGN.md as tokens.` : "",
			result.kept.length ? `Kept the project's value for ${result.kept.join(", ")}.` : "",
			result.placeholders ? `${plural(result.placeholders, "image fill")} became image placeholders.` : "",
		].join(" ");

		toast(`Pasted ${plural(copies.length, "screen")} from Figma`, {
			id: "import-design",
			description: `${notes} Press ⌘Z to undo.`.trim(),
		});
	};

	const paste = async (data: PasteData) => {
		// Read before the clipboard prompt can move the pointer
		const under = point ?? context.pointer();
		const screens = await readScreens(device, data);

		if (screens.length) {
			add(screens, under ? centeredOn(screens, under) : undefined);

			return;
		}

		const html = await data.html();

		if (html && hasFigmaData(html)) {
			await pasteFigma(html, under);

			return;
		}

		if (await context.pasteImages(under, data)) return;
		const imported = html ? await htmlScreen(html, device, context.current()?.theme) : null;

		if (imported) add([imported], under ? centeredOn([imported], under) : undefined);
		else toast("Nothing to paste", { description: "Copy screens, the TSX of a screen, HTML or an image first." });
	};

	const importHtml = async (html: string, screenDevice: Device) => {
		const imported = await htmlScreen(html, screenDevice, context.current()?.theme);

		if (!imported) throw new Error("That HTML has no layout to import.");
		add([imported]);
	};

	/** The screen is one undo step; the site's tokens, when taken, are a second one and the screen already uses them */
	const importCapture = (capture: UrlCapture, screenDevice: Device, siteTheme: DesignTokens | null) => {
		const theme = context.current()?.theme;
		const tokens = siteTheme ? { light: { ...theme?.light, ...siteTheme.light }, dark: theme?.dark ?? {} } : theme;
		const name = capture.tree.title.trim() || new URL(capture.url).host;

		add([importedScreen(treeToTsx(capture.tree, appliedTheme(tokens), name), screenDevice)]);

		if (siteTheme) context.importTokens(siteTheme);
	};

	return [
		{
			id: "rename-screen",
			label: "Rename",
			group: "Screen",
			chords: [{ code: "KeyR", mod: true }],
			enabled: single !== null,
			run: () => single && context.rename(single.file),
		},
		{
			id: "vary-screen",
			label: "Vary this",
			group: "Screen",
			enabled: screen !== null && !busy,
			run: () => screen && context.vary(screen.file, "", context.variations > 1 ? context.variations : 2),
		},
		{
			id: "pick-variation",
			label: "Pick this variation",
			group: "Screen",
			enabled: single !== null && isAlternate(single.file) && !busy,
			run: () => single && context.pick(single.file),
		},
		{
			id: "play-from-here",
			label: "Play from here",
			group: "Screen",
			enabled: screen !== null,
			run: () => screen && context.play(screen.file),
		},
		{
			id: "copy-screens",
			label: "Copy",
			group: "Edit",
			chords: [{ code: "KeyC", mod: true }],
			// Always on: a disabled action would still take ⌘C from text selected in the chat
			enabled: true,
			run: () => {
				const current = context.current();
				const text = window.getSelection()?.toString() ?? "";

				if (text) void navigator.clipboard.writeText(text).catch(() => undefined);
				else if (current && selected.length) void writeScreens(copyScreens(selected, current.files));
			},
		},
		{
			id: "paste-screens",
			label: "Paste",
			group: "Edit",
			chords: [{ code: "KeyV", mod: true }],
			enabled: true,
			run: () => void paste(systemPaste),
			paste: (data) => void paste(data),
		},
		{
			id: "import-page",
			label: "Import from HTML or URL…",
			group: "Screen",
			enabled: true,
			run: () =>
				askPageImport({
					projectPath: context.projectPath,
					device,
					tokens: context.current()?.theme ?? { light: {}, dark: {} },
					importHtml,
					importCapture,
				}),
		},
		{
			id: "new-screen",
			label: "New blank screen",
			group: "Screen",
			chords: [{ code: NEW_SCREEN_CODE, alt: true }],
			enabled: true,
			run: () => addBlank(device),
		},
		...DEVICE_PRESETS.map((preset): Action => ({
			id: presetActionId(preset),
			label: `${preset.label} (${preset.width} × ${preset.height})`,
			group: "New screen",
			enabled: true,
			run: () => addBlank(deviceForSize(preset), preset),
		})),
		{
			id: "new-screen-custom",
			label: "Custom size…",
			group: "New screen",
			enabled: true,
			run: () => askCustomSize((size) => addBlank(deviceForSize(size), size)),
		},
		{
			id: "add-comment",
			label: "Add comment",
			group: "Canvas",
			enabled: true,
			run: () => (point ? context.startComment(point) : context.commentTool()),
		},
	];
}
