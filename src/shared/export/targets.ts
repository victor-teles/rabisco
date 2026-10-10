import { isScreenFile, toKebab } from "../project";
import type { Frame, ProjectFiles } from "../types";
import { isAlternate } from "../variations";

/** The selection (alternates included), or every screen except alternates. */
export function imageTargets(frames: Frame[], selected: Frame[], files: ProjectFiles): Frame[] {
	const exists = (frame: Frame) => isScreenFile(frame.file) && files[frame.file] !== undefined;
	const chosen = selected.filter(exists);

	return chosen.length ? chosen : frames.filter((frame) => exists(frame) && !isAlternate(frame.file));
}

/** `screens/welcome.tsx` → `welcome.png`, made unique with `-2`, `-3`… */
export function imageFileNames(paths: string[], extension: string): string[] {
	const used = new Set<string>();

	return paths.map((path) => {
		const base =
			path
				.split("/")
				.pop()!
				.replace(/\.tsx$/, "") || "screen";

		let name = `${base}.${extension}`;

		for (let n = 2; used.has(name); n++) name = `${base}-${n}.${extension}`;
		used.add(name);

		return name;
	});
}

/** `My App` → `my-app` */
export function exportSlug(projectName: string) {
	const name = projectName.replace(/\.rabisco$/i, "").normalize("NFKD");

	return /[a-z0-9]/i.test(name) ? toKebab(name) : "rabisco";
}
