/**
 * Image export (Phase 7): PNG and SVG files of screens, and a PDF of the flow.
 *
 * Each screen renders in its own hidden frame at its canvas size (so screens
 * that aren't on screen, or never rendered, export too), grows to its content
 * height, and answers a `snapshot` with a `Scene` (`runtime/snapshot.ts`).
 * SVG is written from the scene here; PNG and the PDF's JPEGs are painted
 * from it inside the frame (`runtime/raster.ts`).
 */
import { toast } from "sonner";
import { FrameHost, runtimeUrl, type Snapshot } from "@/lib/render/frame-host";
import type { SnapshotRaster } from "@/lib/render/protocol";
import { api, isDesktop } from "@/lib/rpc";
import { flowDocument, flowOrder, type FlowScreen } from "../../../../shared/export/flow";
import { createPdf, jpegSize } from "../../../../shared/export/pdf";
import { sceneToSvg } from "../../../../shared/export/scene";
import { exportSlug, imageFileNames, imageTargets } from "../../../../shared/export/targets";
import { screenNameFromPath } from "../../../../shared/project";
import type { ExportFile, Frame, ProjectFiles } from "../../../../shared/types";

/** Device pixels per CSS pixel in PNGs and in the PDF */
const SCALE = 2;

const JPEG_QUALITY = 0.88;

/** Screens rendering at once */
const PARALLEL = 3;

/** How often a screen may grow to fit content that grew with it (e.g. `min-h-screen`) */
const GROW_PASSES = 3;

type Rendered = { frame: Frame; snapshot: Snapshot };

type Failure = { frame: Frame; message: string };

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 50));

/**
 * Renders `frame` in a hidden sandboxed frame and snapshots it at its full
 * content height. The frame stays inside the viewport (invisible), since
 * browsers throttle offscreen cross-origin frames.
 */
async function renderScreen(frame: Frame, files: ProjectFiles, raster?: SnapshotRaster): Promise<Snapshot> {
	const iframe = document.createElement("iframe");
	iframe.sandbox.add("allow-scripts");
	iframe.title = `Export ${frame.file}`;
	iframe.tabIndex = -1;
	iframe.setAttribute("aria-hidden", "true");
	Object.assign(iframe.style, {
		position: "fixed",
		left: "0",
		top: "0",
		width: `${frame.width}px`,
		height: `${frame.height}px`,
		border: "0",
		opacity: "0",
		pointerEvents: "none",
		zIndex: "-1",
	});
	const host = new FrameHost(iframe);

	try {
		iframe.src = runtimeUrl();
		document.body.appendChild(iframe);
		host.update(frame.file, files);
		await host.whenRendered();
		let height = frame.height;

		for (let pass = 0; pass < GROW_PASSES; pass++) {
			const content = await host.measure();

			if (!content || content <= height) break;
			height = content;
			iframe.style.height = `${height}px`;
			await nextFrame();
		}

		return await host.snapshot(raster);
	} finally {
		host.dispose();
		iframe.remove();
	}
}

/** Renders every frame, `PARALLEL` at a time, reporting progress. Keeps `frames` order. */
async function renderAll(
	frames: Frame[],
	files: ProjectFiles,
	raster: SnapshotRaster | undefined,
	onProgress: (done: number) => void,
) {
	const results: (Rendered | Failure)[] = [];
	let next = 0;
	let done = 0;

	const worker = async () => {
		while (next < frames.length) {
			const index = next++;
			const frame = frames[index]!;

			try {
				results[index] = { frame, snapshot: await renderScreen(frame, files, raster) };
			} catch (error) {
				results[index] = { frame, message: error instanceof Error ? error.message : String(error) };
			}

			onProgress(++done);
		}
	};

	await Promise.all(Array.from({ length: Math.min(PARALLEL, frames.length) }, worker));

	return {
		rendered: results.filter((r): r is Rendered => "snapshot" in r),
		failed: results.filter((r): r is Failure => "message" in r),
	};
}

const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

function bytesOf(dataUrl: string) {
	const binary = atob(base64Of(dataUrl));
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

	return bytes;
}

function base64OfBytes(bytes: Uint8Array) {
	let binary = "";

	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));

	return btoa(binary);
}

/**
 * Writes `files` into a folder the user picks (`dir`): one file goes in
 * as it is, several into a new `<folder>` subfolder. The browser fallback
 * downloads each file.
 */
async function write(dir: string, files: ExportFile[], folder: string) {
	if (!isDesktop) {
		for (const file of files) await api.writeExport({ dir, files: [file] });

		return dir;
	}

	const { dir: written } = await api.writeExport({
		dir,
		name: files.length > 1 ? folder : undefined,
		files,
		reveal: true,
	});

	return written;
}

const nameOf = (frame: Frame) => frame.name || screenNameFromPath(frame.file);

function failureDescription(failed: Failure[]) {
	const names = failed.map((f) => nameOf(f.frame));

	return `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""} didn't render: ${failed[0]!.message}`;
}

export type ImageExportInput = { projectName: string; frames: Frame[]; selected: Frame[]; files: ProjectFiles };

/**
 * PNG (2x) or SVG files of the selected screens, or of every screen except
 * alternates when none is selected, named after their files (`welcome.png`).
 */
export async function exportImages(format: "png" | "svg", { projectName, frames, selected, files }: ImageExportInput) {
	const targets = imageTargets(frames, selected, files);

	if (!targets.length) return void toast("No screens to export");
	const dir = await api.pickExportFolder({});

	if (!dir) return;
	const label = format.toUpperCase();
	const id = toast.loading(`Rendering ${targets.length === 1 ? nameOf(targets[0]!) : `${targets.length} screens`}…`);

	try {
		const raster = format === "png" ? ({ type: "image/png", scale: SCALE } as const) : undefined;

		const { rendered, failed } = await renderAll(targets, files, raster, (done) => {
			if (targets.length > 1) toast.loading(`Rendering screens… ${done} of ${targets.length}`, { id });
		});

		if (!rendered.length) throw new Error(failureDescription(failed));

		const names = imageFileNames(
			rendered.map((r) => r.frame.file),
			format,
		);

		const exported: ExportFile[] = rendered.map(({ frame, snapshot }, i) =>
			format === "png"
				? { path: names[i]!, content: base64Of(snapshot.raster!.dataUrl), encoding: "base64" }
				: { path: names[i]!, content: sceneToSvg(snapshot.scene, nameOf(frame)) },
		);

		const written = await write(dir, exported, `${exportSlug(projectName)}-${format === "png" ? "images" : "svg"}`);
		const what = exported.length === 1 ? exported[0]!.path : `${exported.length} ${label}s`;

		if (failed.length) toast.warning(`Exported ${what}`, { id, description: failureDescription(failed) });
		else toast.success(`Exported ${what}`, { id, description: isDesktop ? written : undefined });
	} catch (error) {
		toast.error(`${label} export failed`, { id, description: error instanceof Error ? error.message : String(error) });
	}
}

/**
 * `<project>-flow.pdf`: every screen except alternates, in flow order
 * (prototype links breadth-first from the first screen on the canvas), one
 * page each after an overview page, with links that jump between pages.
 */
export async function exportFlowPdf({ projectName, frames, files }: Omit<ImageExportInput, "selected">) {
	const screens = imageTargets(frames, [], files);

	if (!screens.length) return void toast("No screens to export");
	const byFile = new Map(screens.map((frame) => [frame.file, frame]));

	const ordered = flowOrder(
		screens.map((s) => s.file),
		files,
	).map((file) => byFile.get(file)!);

	const dir = await api.pickExportFolder({});

	if (!dir) return;
	const id = toast.loading(`Rendering ${ordered.length} screens…`);

	try {
		const { rendered, failed } = await renderAll(
			ordered,
			files,
			{ type: "image/jpeg", scale: SCALE, quality: JPEG_QUALITY },
			(done) => toast.loading(`Rendering screens… ${done} of ${ordered.length}`, { id }),
		);

		if (!rendered.length) throw new Error(failureDescription(failed));
		toast.loading("Writing the PDF…", { id });

		const flow: FlowScreen[] = rendered.map(({ frame, snapshot }) => {
			const jpeg = bytesOf(snapshot.raster!.dataUrl);
			const size = jpegSize(jpeg);

			if (!size) throw new Error(`${nameOf(frame)} didn't produce a JPEG`);

			return {
				file: frame.file,
				name: nameOf(frame),
				width: snapshot.scene.width,
				height: snapshot.scene.height,
				image: { jpeg, ...size },
				links: snapshot.scene.links,
			};
		});

		const pdf = createPdf(flowDocument({ title: projectName, screens: flow, files }));
		const name = `${exportSlug(projectName)}-flow.pdf`;
		await write(dir, [{ path: name, content: base64OfBytes(pdf), encoding: "base64" }], name);

		if (failed.length) toast.warning(`Exported ${name}`, { id, description: failureDescription(failed) });
		else toast.success(`Exported ${name}`, { id, description: `${flow.length} screens in flow order` });
	} catch (error) {
		toast.error("PDF export failed", { id, description: error instanceof Error ? error.message : String(error) });
	}
}
