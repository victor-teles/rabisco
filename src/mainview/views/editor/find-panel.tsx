import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CaseSensitive, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import type { ChangeOptions } from "@/hooks/use-project";
import type { Snapshot } from "@/lib/history";
import { cn } from "@/lib/utils";
import { findInFiles, replaceText, type TextMatch } from "../../../shared/jsx/find-text";
import type { Frame, ProjectFiles } from "../../../shared/types";

type FindPanelProps = {
	frames: Frame[];
	files: ProjectFiles;
	focusKey: number;
	busyReason?: string;
	change: (recipe: (snapshot: Snapshot) => Snapshot, options?: ChangeOptions) => void;
	onSelect: (file: string, element: number) => void;
	onClose: () => void;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const resultKey = (file: string, match: TextMatch) => `${file}\n${match.at}`;

export function FindPanel({ frames, files, focusKey, busyReason, change, onSelect, onClose }: FindPanelProps) {
	const [query, setQuery] = useState("");
	const [replacement, setReplacement] = useState("");
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [active, setActive] = useState<string | null>(null);
	const field = useRef<HTMLInputElement>(null);
	const deferred = useDeferredValue(query);
	const options = useMemo(() => ({ caseSensitive }), [caseSensitive]);

	useEffect(() => {
		field.current?.focus();
		field.current?.select();
	}, [focusKey]);

	const paths = useMemo(() => frames.map((frame) => frame.file), [frames]);
	const results = useMemo(() => findInFiles(files, paths, deferred, options), [files, paths, deferred, options]);
	const names = new Map(frames.map((frame) => [frame.file, frame.name]));
	const total = results.reduce((sum, result) => sum + result.matches.length, 0);
	const flat = results.flatMap(({ file, matches }) => matches.map((match) => ({ file, match })));

	const choose = (file: string, match: TextMatch) => {
		setActive(resultKey(file, match));
		onSelect(file, match.element);
	};

	const step = (direction: 1 | -1) => {
		if (!flat.length) return;
		const at = flat.findIndex(({ file, match }) => resultKey(file, match) === active);
		const next = flat[(at + direction + flat.length) % flat.length] ?? flat[0]!;
		choose(next.file, next.match);
	};

	const blocked = () => {
		if (busyReason) toast(busyReason);

		return Boolean(busyReason);
	};

	const replaceOne = (file: string, match: TextMatch) => {
		if (blocked()) return;
		change((snapshot) => {
			const source = snapshot.files[file];

			const next =
				source === undefined ? source : replaceText(source, deferred, replacement, options, new Set([match.at]));

			return next === undefined || next === source
				? snapshot
				: { ...snapshot, files: { ...snapshot.files, [file]: next } };
		});
	};

	const replaceAll = () => {
		if (blocked() || !total) return;
		change((snapshot) => {
			const edited: ProjectFiles = {};

			for (const { file } of results) {
				const source = snapshot.files[file];
				const next = source === undefined ? source : replaceText(source, deferred, replacement, options);

				if (next !== undefined && next !== source) edited[file] = next;
			}

			return Object.keys(edited).length ? { ...snapshot, files: { ...snapshot.files, ...edited } } : snapshot;
		});
		toast(`Replaced ${plural(total, "match")} in ${plural(results.length, "screen")}`);
	};

	return (
		<div
			role="search"
			aria-label="Find and replace"
			className="absolute top-3 right-3 flex max-h-[calc(100%-5rem)] w-80 flex-col overflow-hidden rounded-xl border bg-popover text-[13px] shadow-[0_8px_24px_-8px_rgb(0_0_0/0.18)]"
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.stopPropagation();
				onClose();
			}}
		>
			<div className="flex flex-col gap-1.5 border-b p-2">
				<div className="flex items-center gap-1">
					<Search className="ml-1 size-3.5 shrink-0 text-subtle-foreground" />
					<input
						ref={field}
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActive(null);
						}}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							step(event.shiftKey ? -1 : 1);
						}}
						placeholder="Find text in screens"
						aria-label="Find"
						className="h-7 min-w-0 flex-1 bg-transparent px-1 outline-none placeholder:text-subtle-foreground"
					/>
					<Toggle
						size="sm"
						pressed={caseSensitive}
						onPressedChange={setCaseSensitive}
						aria-label="Match case"
						title="Match case"
						className="size-7 min-w-7"
					>
						<CaseSensitive />
					</Toggle>
					<Button variant="ghost" size="icon-sm" aria-label="Close find" onClick={onClose}>
						<X />
					</Button>
				</div>
				<div className="flex items-center gap-1">
					<input
						value={replacement}
						onChange={(event) => setReplacement(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							replaceAll();
						}}
						placeholder="Replace with"
						aria-label="Replace with"
						className="h-7 min-w-0 flex-1 rounded-md bg-muted/60 px-2 outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					/>
					<Button variant="secondary" size="sm" className="h-7" disabled={!total} onClick={replaceAll}>
						Replace all
					</Button>
				</div>
			</div>
			{deferred ? (
				<div className="min-h-0 flex-1 overflow-y-auto p-1">
					{results.length === 0 ? (
						<p className="px-2 py-1.5 text-subtle-foreground">No text matches “{deferred}”.</p>
					) : (
						<>
							<p className="px-2 pt-1 pb-1.5 text-xs text-subtle-foreground">
								{plural(total, "match")} in {plural(results.length, "screen")}
							</p>
							{results.map(({ file, matches }) => (
								<div key={file} role="group" aria-label={names.get(file) ?? file} className="pb-1">
									<p className="truncate px-2 py-1 text-xs font-medium text-muted-foreground">
										{names.get(file) ?? file}
									</p>
									{matches.map((match) => {
										const key = resultKey(file, match);

										return (
											<div
												key={key}
												className={cn(
													"group/result flex items-center gap-1 rounded-md pr-1 hover:bg-accent",
													active === key && "bg-accent",
												)}
											>
												<button
													type="button"
													className="min-w-0 flex-1 truncate px-2 py-1 text-left text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
													onClick={() => choose(file, match)}
												>
													{match.before}
													<mark className="rounded-[2px] bg-primary/15 text-foreground">{match.text}</mark>
													{match.after}
												</button>
												<Button
													variant="ghost"
													size="xs"
													className="h-6 shrink-0 opacity-0 group-hover/result:opacity-100 focus-visible:opacity-100"
													onClick={() => replaceOne(file, match)}
												>
													Replace
												</Button>
											</div>
										);
									})}
								</div>
							))}
						</>
					)}
				</div>
			) : null}
		</div>
	);
}
