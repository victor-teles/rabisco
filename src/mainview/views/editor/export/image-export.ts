import { toast } from "sonner";
import { FrameHost, runtimeUrl, type Snapshot } from "@/lib/render/frame-host";
import { OFFSTAGE_FRAME_STYLE, offstage } from "@/lib/render/offstage";
import type { SnapshotRaster } from "@/lib/render/protocol";
import { themeCss } from "@/lib/render/styles";
import { api, isDesktop } from "@/lib/rpc";
import type { DesignTokens } from "../../../../shared/context/tokens";
import { flowDocument, flowOrder, type FlowScreen } from "../../../../shared/export/flow";
import { createPdf, jpegSize } from "../../../../shared/export/pdf";
import { sceneToSvg } from "../../../../shared/export/scene";
import { exportSlug, imageFileNames, imageTargets } from "../../../../shared/export/targets";
import { screenNameFromPath } from "../../../../shared/project";
import type { ExportFile, Frame, ProjectFiles } from "../../../../shared/types";

/** Device pixels per CSS pixel in PNGs and in the PDF */
const SCALE = 2;

const JPEG_QUALITY = 0.88;

const PARALLEL = 3;

/** Passes to grow a screen whose content grows with it (e.g. `min-h-screen`) */
const GROW_PASSES = 3;

type Rendered = { frame: Frame; snapshot: Snapshot };

type Failure = { frame: Frame; message: string };

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Renders in an `offstage()` frame */
async function renderScreen(
	frame: Frame,
	files: ProjectFiles,
	theme: DesignTokens,
	raster?: SnapshotRaster,
): Promise<Snapshot> {
	const iframe = document.createElement("iframe");
	iframe.sandbox.add("allow-scripts");
	iframe.title = `Export ${frame.file}`;
	iframe.tabIndex = -1;
	iframe.setAttribute("aria-hidden", "true");
	iframe.style.cssText = OFFSTAGE_FRAME_STYLE;
	iframe.style.width = `${frame.width}px`;
	iframe.style.height = `${frame.height}px`;
	const host = new FrameHost(iframe);

	try {
		iframe.src = runtimeUrl();
		offstage().appendChild(iframe);
		host.update(frame.file, files, themeCss(theme));
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

async function renderAll(
	frames: Frame[],
	files: ProjectFiles,
	theme: DesignTokens,
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
				results[index] = { frame, snapshot: await renderScreen(frame, files, theme, raster) };
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

/** Several files go into a new `folder` subfolder; the browser fallback downloads each file */
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

export type ImageExportInput = {
	projectName: string;
	frames: Frame[];
	selected: Frame[];
	files: ProjectFiles;
	/** The applied tokens, so images match the canvas */
	theme: DesignTokens;
};

/** Without a selection, every screen except alternates */
export async function exportImages(
	format: "png" | "svg",
	{ projectName, frames, selected, files, theme }: ImageExportInput,
) {
	const targets = imageTargets(frames, selected, files);

	if (!targets.length) return void toast("No screens to export");
	const dir = await api.pickExportFolder({});

	if (!dir) return;
	const label = format.toUpperCase();
	const id = toast.loading(`Rendering ${targets.length === 1 ? nameOf(targets[0]!) : `${targets.length} screens`}…`);

	try {
		const raster = format === "png" ? ({ type: "image/png", scale: SCALE } as const) : undefined;

		const { rendered, failed } = await renderAll(targets, files, theme, raster, (done) => {
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

/** Flow order: prototype links breadth-first from the first screen on the canvas. `only` limits it to those screens */
export async function exportFlowPdf(
	{ projectName, frames, files, theme }: Omit<ImageExportInput, "selected">,
	only: Frame[] = [],
) {
	const screens = imageTargets(frames, only, files);

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
			theme,
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
		const name = only.length === 1 ? imageFileNames([only[0]!.file], "pdf")[0]! : `${exportSlug(projectName)}-flow.pdf`;
		await write(dir, [{ path: name, content: base64OfBytes(pdf), encoding: "base64" }], name);

		if (failed.length) toast.warning(`Exported ${name}`, { id, description: failureDescription(failed) });
		else toast.success(`Exported ${name}`, { id, description: `${flow.length} screens in flow order` });
	} catch (error) {
		toast.error("PDF export failed", { id, description: error instanceof Error ? error.message : String(error) });
	}
}

/** The PNG is a promise so WebKit keeps the click's user activation while the screen renders */
export async function copyImage(frame: Frame, files: ProjectFiles, theme: DesignTokens) {
	const id = toast.loading(`Rendering ${nameOf(frame)}…`);

	const png = renderScreen(frame, files, theme, { type: "image/png", scale: SCALE }).then(
		(snapshot) => new Blob([bytesOf(snapshot.raster!.dataUrl)], { type: "image/png" }),
	);

	try {
		await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
		toast.success(`Copied ${nameOf(frame)} as PNG`, { id });
	} catch (error) {
		toast.error("Couldn't copy the image", { id, description: error instanceof Error ? error.message : String(error) });
	}
}
