/** Messages between the host webview and the screen runtime inside each frame. */

/** Where an error points to in project source. Lines and columns are 1-based. */
export type SourceLocation = { line: number; column?: number };

export type CompileError = SourceLocation & { message: string };

/** One project module as the frame receives it: compiled code, or the reason it did not compile. */
export type ModulePayload =
	| { code: string; source: string; error?: undefined }
	| { code?: undefined; source: string; error: CompileError };

/** Host → frame. `modules` holds only what changed since the last message; `null` deletes a module. */
export type HostMessage =
	| {
			type: "modules";
			entry: string;
			modules: Record<string, ModulePayload | null>;
			/** Present when the stylesheet changed */
			css?: string;
			/** Drop everything the frame knew before this message */
			reset?: boolean;
	  }
	| { type: "css"; css: string };

/** A render error, as the frame reports it. */
export type FrameError = {
	kind: "compile" | "runtime" | "missing-module";
	message: string;
	file?: string;
	line?: number;
	column?: number;
	/** Source lines around `line` */
	excerpt?: { line: number; text: string }[];
};

/** Frame → host */
export type FrameMessage = { type: "ready" } | { type: "rendered" } | { type: "error"; error: FrameError };

/** `sourceURL` prefix of every project module, so stack traces carry the file. */
export const SOURCE_URL_PREFIX = "rabisco://project/";
