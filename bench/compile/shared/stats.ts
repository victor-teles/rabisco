export type Stat = {
	name: string;
	n: number;
	median: number;
	p95: number;
	min: number;
	mean: number;
	note?: string;
};

const round = (value: number) => Math.round(value * 1000) / 1000;

export function summarize(name: string, samples: number[], note?: string): Stat {
	const sorted = [...samples].sort((a, b) => a - b);
	const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

	return {
		name,
		n: samples.length,
		median: round(pick(0.5)),
		p95: round(pick(0.95)),
		min: round(sorted[0]!),
		mean: round(samples.reduce((a, b) => a + b, 0) / samples.length),
		note,
	};
}

/** Keeps outputs alive so the engine cannot skip the work being measured. */
export let sink = 0;

export async function measure<T>(
	name: string,
	fn: () => T | Promise<T>,
	{
		warmup = 5,
		iterations = 30,
		batch = 1,
		note,
	}: { warmup?: number; iterations?: number; batch?: number; note?: string } = {},
): Promise<Stat> {
	for (let i = 0; i < warmup; i++) consume(await fn());
	const samples: number[] = [];

	for (let i = 0; i < iterations; i++) {
		// WebKit clamps performance.now() to 1 ms, so time a batch and divide
		const start = performance.now();

		for (let j = 0; j < batch; j++) consume(await fn());
		samples.push((performance.now() - start) / batch);
	}

	return summarize(name, samples, batch > 1 ? [note, `batch of ${batch}`].filter(Boolean).join(", ") : note);
}

/** For cold paths such as initialising a wasm module. */
export async function once<T>(name: string, fn: () => T | Promise<T>, note?: string): Promise<Stat> {
	const start = performance.now();
	consume(await fn());

	return summarize(name, [performance.now() - start], note);
}

function consume<T>(value: T) {
	if (isText(value)) sink += value.length;
	else if (value) sink += 1;
}

function isText<T>(value: T): value is T & string {
	return typeof value === "string";
}

/** A cheap superset; Tailwind ignores invalid tokens. */
export function extractCandidates(source: string): string[] {
	const set = new Set<string>();

	for (const token of source.split(/[\s"'`{}()<>;,=]+/)) {
		if (token.length > 1 && token.length < 80 && /^[!-]?[a-z@[]/.test(token)) set.add(token);
	}

	return [...set];
}
