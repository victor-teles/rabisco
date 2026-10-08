import { generateMockScreens } from "../../src/shared/mock-generator";
import type { Frame, ProjectFiles } from "../../src/shared/types";

const PROMPTS = [
	"A habit tracker with streaks",
	"Banking app for freelancers",
	"Recipe planner for busy parents",
	"Team chat for nurses",
	"Booking site for climbing gyms",
	"Analytics for a coffee chain",
	"Language learning flashcards",
	"Travel journal with maps",
];

export type SyntheticProject = { files: ProjectFiles; frames: Frame[] };

/** A synthetic project of mock-generator screens and their components, mobile and desktop mixed. */
export function syntheticProject(screens = 30): SyntheticProject {
	const files: ProjectFiles = {};
	const frames: Frame[] = [];

	for (let round = 0; frames.length < screens; round++) {
		const result = generateMockScreens({
			prompt: `${PROMPTS[round % PROMPTS.length]} ${round}`,
			device: round % 2 ? "desktop" : "mobile",
			existingFiles: Object.keys(files),
		});

		for (const change of result.changes) if (change.content !== null) files[change.path] = change.content;

		for (const frame of result.frames) {
			if (frames.length < screens) frames.push({ ...frame, y: round * 1000 });
		}
	}

	for (const path of Object.keys(files)) {
		if (path.startsWith("screens/") && !frames.some((frame) => frame.file === path)) delete files[path];
	}

	return { files, frames };
}
