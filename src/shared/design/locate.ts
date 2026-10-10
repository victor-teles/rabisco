import type { ProjectFiles } from "../types";
import type { DesignFinding } from "./findings";

/** 1-based */
export function lineAt(source: string, offset: number) {
	let line = 1;
	const end = Math.min(offset, source.length);

	for (let i = 0; i < end; i++) if (source.charCodeAt(i) === 10) line++;

	return line;
}

/** Frame findings carry `path` and `start` only; the host has the sources to number them. */
export function withLines(findings: DesignFinding[], files: ProjectFiles): DesignFinding[] {
	return findings.map((finding) => {
		const source = finding.path === undefined ? undefined : files[finding.path];

		if (finding.line !== undefined || finding.start === undefined || source === undefined) return finding;

		return { ...finding, line: lineAt(source, finding.start) };
	});
}
