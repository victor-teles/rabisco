import { useMemo, useState } from "react";
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

/** Read-only, line-numbered source of one file. Re-renders whenever the file changes (also on external edits). */
export function CodeView({ path, source }: { path: string; source: string | undefined }) {
	const lines = useMemo(() => tokenizeLines(source ?? ""), [source]);
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		if (source === undefined) return;
		await navigator.clipboard.writeText(source);
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
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
			{source === undefined ? (
				<p className="p-4 text-[13px] text-subtle-foreground">This file is missing on disk.</p>
			) : (
				<div className="min-h-0 flex-1 overflow-auto">
					<pre className="min-w-max py-3 font-mono text-xs/5" style={{ tabSize: 2 }}>
						<code>
							{lines.map((tokens, index) => (
								<div key={index} className="flex">
									<span className="sticky left-0 w-11 shrink-0 bg-background pr-3 text-right text-subtle-foreground/70 tabular-nums select-none">
										{index + 1}
									</span>
									<span className="pr-4">
										{tokens.length
											? tokens.map((token, i) => (
													<span key={i} className={cn(TOKEN_CLASS[token.kind])}>
														{token.text}
													</span>
												))
											: "​"}
									</span>
								</div>
							))}
						</code>
					</pre>
				</div>
			)}
		</div>
	);
}
