import { GENERATION_STEPS, generateMockScreens } from "../../shared/mock-generator";
import type { GenerateScreensParams, GenerateScreensResult, GenerationStep } from "../../shared/types";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Turns a prompt into screen and component files, with frames laid out from
 * the canvas origin; the editor writes the files and offsets the frames.
 *
 * TODO: replace the mock with a real provider (decision 0003) that writes TSX
 * files, streaming steps through `onStep` as tool calls / thinking arrive.
 */
export async function generateScreens(
	params: GenerateScreensParams,
	onStep: (step: GenerationStep) => void,
): Promise<GenerateScreensResult> {
	for (const step of GENERATION_STEPS) {
		onStep({ generationId: params.generationId, label: step.label });
		await wait(450);
	}
	return generateMockScreens({ prompt: params.prompt, device: params.device, existingFiles: params.existingFiles });
}
