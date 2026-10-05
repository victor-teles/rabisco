import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { tokenizeLines, type TokenKind } from "@/lib/highlight";
import { cn } from "@/lib/utils";

const TOKEN_CLASS: Record<TokenKind, string> = {
	plain: "",
	comment: "text-subtle-foreground italic",
	string: "text-emerald-700 dark:text-emerald-400",
	keyword: "text-violet-700 dark:text-violet-400",
	number: "text-amber-700 dark:text-amber-400",
	tag: "text-sky-700 dark:text-sky-400",
	attr: "text-orange-700 dark:text-orange-300",
	punct: "text-muted-foreground",
};

/** Matches `text-xs/5` and `py-3` below; the caret math depends on them */
const LINE_HEIGHT = 20;

const PADDING_TOP = 12;

const GUTTER = 44;

const TAB_SIZE = 2;

export function CodeHeader({ path, source }: { path: string; source: string | undefined }) {
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		if (source === undefined) return;
		await navigator.clipboard.writeText(source);
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	};

	return (
		<div className="flex h-10 shrink-0 items-center gap-2 border-b pr-2 pl-4">
			<span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={path}>
				{path}
			</span>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="ghost" size="icon-xs" aria-label="Copy code" onClick={copy} disabled={source === undefined}>
						{copied ? <Check /> : <Copy />}
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">{copied ? "Copied" : "Copy code"}</TooltipContent>
			</Tooltip>
		</div>
	);
}

function lineStarts(source: string) {
	const starts = [0];

	for (let i = source.indexOf("\n"); i !== -1; i = source.indexOf("\n", i + 1)) starts.push(i + 1);

	return starts;
}

function lineOf(starts: number[], offset: number) {
	let low = 0;
	let high = starts.length - 1;

	while (low < high) {
		const mid = (low + high + 1) >> 1;

		if (starts[mid]! <= offset) low = mid;
		else high = mid - 1;
	}

	return low;
}

/** With tabs expanded */
function columnOf(source: string, lineStart: number, offset: number) {
	let column = 0;

	for (let i = lineStart; i < offset; i++)
		column = source[i] === "\t" ? (Math.floor(column / TAB_SIZE) + 1) * TAB_SIZE : column + 1;

	return column;
}

type CodeEditorProps = {
	source: string;
	label: string;
	highlight: { start: number; end: number } | null;
	/** Bumped to scroll the highlight into view */
	revealKey: number;
	/** `step` groups the edits of one focus into a single undo step */
	onEdit: (text: string, step: string) => void;
	onEndStep: () => void;
	onUndo: () => void;
	onRedo: () => void;
	/** Only when no text is selected */
	onCaretClick?: (offset: number) => void;
	/** While a generation runs */
	readOnly?: boolean;
};

/** A transparent textarea over highlighted text with the same metrics, so typing, selection and IME stay native */
export function CodeEditor({
	source,
	label,
	highlight,
	revealKey,
	onEdit,
	onEndStep,
	onUndo,
	onRedo,
	onCaretClick,
	readOnly = false,
}: CodeEditorProps) {
	const lines = useMemo(() => tokenizeLines(source), [source]);
	const starts = useMemo(() => lineStarts(source), [source]);
	const scroller = useRef<HTMLDivElement>(null);
	const area = useRef<HTMLTextAreaElement>(null);
	const measure = useRef<HTMLSpanElement>(null);
	const focusId = useRef(0);
	/** Tells typing from undo and external edits */
	const typed = useRef<string | null>(null);
	const caret = useRef({ start: 0, end: 0 });

	const first = highlight ? lineOf(starts, highlight.start) : -1;
	const last = highlight ? lineOf(starts, Math.max(highlight.start, highlight.end - 1)) : -1;

	/** `center` puts `offset` a third down the view */
	const reveal = (offset: number, center = false) => {
		const box = scroller.current;

		if (!box) return;
		const line = lineOf(starts, offset);
		const y = PADDING_TOP + line * LINE_HEIGHT;

		if (center && (y < box.scrollTop || y + LINE_HEIGHT > box.scrollTop + box.clientHeight))
			box.scrollTop = y - box.clientHeight / 3;
		else if (y < box.scrollTop) box.scrollTop = y - PADDING_TOP;
		else if (y + LINE_HEIGHT > box.scrollTop + box.clientHeight)
			box.scrollTop = y + LINE_HEIGHT + PADDING_TOP - box.clientHeight;

		if (center) return;
		const charWidth = (measure.current?.getBoundingClientRect().width ?? 72) / 10;
		const x = GUTTER + columnOf(source, starts[line]!, offset) * charWidth;

		if (x < box.scrollLeft + GUTTER) box.scrollLeft = Math.max(0, x - GUTTER - 4 * charWidth);
		else if (x + charWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = x + 8 * charWidth - box.clientWidth;
	};

	// Undo, redo and external edits replace the value: keep the caret where it was
	useLayoutEffect(() => {
		const element = area.current;

		if (!element || document.activeElement !== element || typed.current === source) return;
		const start = Math.min(caret.current.start, source.length);
		element.setSelectionRange(start, Math.min(Math.max(caret.current.end, start), source.length));
	}, [source]);

	useLayoutEffect(() => {
		if (highlight && revealKey) reveal(highlight.start, true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [revealKey]);

	const remember = () => {
		const element = area.current;

		if (element) caret.current = { start: element.selectionStart, end: element.selectionEnd };
	};

	const followCaret = () => {
		remember();
		requestAnimationFrame(() => area.current && reveal(area.current.selectionEnd));
	};

	/** A native edit so the input event fires; falls back to a manual splice */
	const insert = (element: HTMLTextAreaElement, text: string) => {
		if (readOnly) return;

		if (document.execCommand?.("insertText", false, text)) return;
		const { selectionStart: from, selectionEnd: to, value } = element;
		const next = value.slice(0, from) + text + value.slice(to);
		typed.current = next;
		caret.current = { start: from + text.length, end: from + text.length };
		onEdit(next, `code:${focusId.current}`);
		requestAnimationFrame(() => element.setSelectionRange(from + text.length, from + text.length));
	};

	const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		const element = event.currentTarget;
		const mod = event.metaKey || event.ctrlKey;

		if (mod && !event.altKey && (event.code === "KeyZ" || event.code === "KeyY")) {
			event.preventDefault();
			remember();
			onEndStep();

			if (event.code === "KeyY" || event.shiftKey) onRedo();
			else onUndo();
			focusId.current += 1;
		} else if (readOnly) {
			if (event.key === "Escape") element.blur();
		} else if (event.key === "Tab" && !event.shiftKey && !mod && !event.altKey) {
			// ⇧Tab still leaves the editor, so the keyboard is never trapped
			event.preventDefault();
			insert(element, "\t");
		} else if (event.key === "Enter" && !mod && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			const lineStart = element.value.lastIndexOf("\n", element.selectionStart - 1) + 1;
			const indent = /^[ \t]*/.exec(element.value.slice(lineStart, element.selectionStart))![0];
			insert(element, `\n${indent}`);
		} else if (event.key === "Escape") element.blur();
	};

	return (
		<div ref={scroller} className="relative min-h-0 flex-1 overflow-auto">
			<div className="flex min-h-full min-w-max py-3 font-mono text-xs/5">
				<div
					aria-hidden
					className="sticky left-0 z-10 w-11 shrink-0 bg-background pr-3 text-right text-subtle-foreground/70 tabular-nums select-none"
				>
					{lines.map((_, index) => (
						<div key={index} className={cn(index >= first && index <= last && "text-muted-foreground")}>
							{index + 1}
						</div>
					))}
				</div>
				<div className="relative grow pr-4">
					<pre aria-hidden className="pointer-events-none" style={{ tabSize: TAB_SIZE }}>
						<code>
							{lines.map((tokens, index) => (
								<div key={index} className={cn(index >= first && index <= last && "-ml-1 bg-primary/[0.07] pl-1")}>
									{tokens.length
										? tokens.map((token, i) => (
												<span key={i} className={cn(TOKEN_CLASS[token.kind])}>
													{token.text}
												</span>
											))
										: "​"}
								</div>
							))}
						</code>
					</pre>
					<span ref={measure} aria-hidden className="invisible absolute top-0 left-0 whitespace-pre">
						0000000000
					</span>
					<textarea
						ref={area}
						value={source}
						aria-label={label}
						readOnly={readOnly}
						aria-description="Tab inserts a tab; Shift Tab or Escape leaves the editor."
						spellCheck={false}
						autoCapitalize="off"
						autoCorrect="off"
						wrap="off"
						onFocus={() => {
							focusId.current += 1;
						}}
						onBlur={onEndStep}
						onChange={(event) => {
							if (readOnly) return;
							typed.current = event.target.value;
							onEdit(event.target.value, `code:${focusId.current}`);
							followCaret();
						}}
						onKeyDown={onKeyDown}
						onKeyUp={followCaret}
						onSelect={remember}
						onMouseUp={(event) => {
							const { selectionStart, selectionEnd } = event.currentTarget;
							remember();

							if (selectionStart === selectionEnd) onCaretClick?.(selectionStart);
						}}
						// The container scrolls, never the textarea itself
						onScroll={(event) => {
							event.currentTarget.scrollTop = 0;
							event.currentTarget.scrollLeft = 0;
						}}
						className="absolute inset-0 resize-none overflow-hidden bg-transparent p-0 whitespace-pre text-transparent caret-foreground outline-none selection:bg-primary/20"
						style={{ tabSize: TAB_SIZE }}
					/>
				</div>
			</div>
		</div>
	);
}
