/** The runs of a parallel generation: a planned screen, by its path, or a variation (`variation-<n>`) */
export function createRunParts(signal: AbortSignal) {
	const controllers = new Map<string, AbortController>();

	return {
		signal(part: string) {
			const controller = new AbortController();
			controllers.set(part, controller);

			return AbortSignal.any([signal, controller.signal]);
		},
		stop(part: string) {
			controllers.get(part)?.abort();
		},
		stopped: (part: string) => !signal.aborted && controllers.get(part)?.signal.aborted === true,
	};
}

export type RunParts = ReturnType<typeof createRunParts>;

export const variationPart = (variant: number) => `variation-${variant}`;

export const variationPartName = (variant: number) => `Variation ${variant + 1}`;
