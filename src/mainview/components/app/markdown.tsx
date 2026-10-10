import { memo, useMemo, type ReactNode } from "react";
import { api } from "@/lib/rpc";
import { parseMarkdown, type Inline } from "@/lib/markdown";
import { cn } from "@/lib/utils";

function renderInline(nodes: Inline[]): ReactNode[] {
	return nodes.map((node, index) => {
		switch (node.type) {
			case "text":
				return node.text;
			case "code":
				return (
					<code key={index} className="rounded-[4px] bg-muted px-1 py-px font-mono text-[12px]">
						{node.text}
					</code>
				);
			case "strong":
				return (
					<strong key={index} className="font-semibold">
						{renderInline(node.children)}
					</strong>
				);
			case "em":
				return <em key={index}>{renderInline(node.children)}</em>;
			case "link":
				return (
					<a
						key={index}
						href={node.href}
						title={node.href}
						// The webview must not navigate away; links open in the browser
						onClick={(event) => {
							event.preventDefault();
							void api.openExternal({ url: node.href });
						}}
						className="underline underline-offset-2 hover:text-muted-foreground"
					>
						{renderInline(node.children)}
					</a>
				);
		}
	});
}

/** Model replies as Markdown, rendered from a parsed tree: raw HTML shows as text */
export const Markdown = memo(function Markdown({ source, className }: { source: string; className?: string }) {
	const blocks = useMemo(() => parseMarkdown(source), [source]);

	return (
		<div className={cn("flex flex-col gap-2", className)}>
			{blocks.map((block, index) => {
				switch (block.type) {
					case "heading":
						return (
							<p key={index} className="font-semibold">
								{renderInline(block.children)}
							</p>
						);
					case "paragraph":
						return (
							<p key={index} className="whitespace-pre-wrap">
								{renderInline(block.children)}
							</p>
						);
					case "quote":
						return (
							<blockquote key={index} className="border-l-2 pl-2.5 whitespace-pre-wrap text-muted-foreground">
								{renderInline(block.children)}
							</blockquote>
						);
					case "code":
						return (
							<pre key={index} className="overflow-x-auto rounded-md bg-muted px-2.5 py-2 font-mono text-[12px]/[18px]">
								<code>{block.text}</code>
							</pre>
						);
					case "list": {
						const List = block.ordered ? "ol" : "ul";

						return (
							<List
								key={index}
								start={block.ordered ? block.start : undefined}
								className={cn("flex flex-col gap-0.5 pl-4", block.ordered ? "list-decimal" : "list-disc")}
							>
								{block.items.map((item, at) => (
									<li key={at} className="whitespace-pre-wrap">
										{renderInline(item)}
									</li>
								))}
							</List>
						);
					}
				}
			})}
		</div>
	);
});
