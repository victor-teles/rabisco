import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { paletteTokens, parseBrandKit, type BrandKit, type LogoPalette } from "../../../shared/context/brand-kit";
import { orderedTokenNames, tokenKind, type DesignTokens } from "../../../shared/context/tokens";

export type BrandImport = { kind: "url" } | { kind: "logo"; palette: LogoPalette; image: string; name: string };

type Loaded = Exclude<BrandKit, { kind: "error" }> & { host: string };

const countOf = (tokens: DesignTokens) => Object.keys(tokens.light).length + Object.keys(tokens.dark).length;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export async function logoPixels(file: File): Promise<Uint8ClampedArray> {
	const url = URL.createObjectURL(file);

	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		const width = image.naturalWidth || 128;
		const height = image.naturalHeight || 128;
		const scale = Math.min(1, 128 / Math.max(width, height));
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(width * scale));
		canvas.height = Math.max(1, Math.round(height * scale));
		const context = canvas.getContext("2d", { willReadFrequently: true });

		if (!context) throw new Error("This window can't read images");
		context.drawImage(image, 0, 0, canvas.width, canvas.height);

		return context.getImageData(0, 0, canvas.width, canvas.height).data;
	} finally {
		URL.revokeObjectURL(url);
	}
}

export function BrandImportDialog({
	request,
	current,
	onClose,
	onApplyTokens,
	onReplaceDesign,
}: {
	request: BrandImport | null;
	current: DesignTokens;
	onClose: () => void;
	onApplyTokens: (tokens: DesignTokens) => void;
	onReplaceDesign: (markdown: string) => void;
}) {
	return (
		<Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-md" showCloseButton={false}>
				{request?.kind === "url" ? (
					<UrlImport
						current={current}
						onClose={onClose}
						onApplyTokens={onApplyTokens}
						onReplaceDesign={onReplaceDesign}
					/>
				) : request?.kind === "logo" ? (
					<LogoImport request={request} current={current} onClose={onClose} onApplyTokens={onApplyTokens} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function UrlImport({
	current,
	onClose,
	onApplyTokens,
	onReplaceDesign,
}: {
	current: DesignTokens;
	onClose: () => void;
	onApplyTokens: (tokens: DesignTokens) => void;
	onReplaceDesign: (markdown: string) => void;
}) {
	const [url, setUrl] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loaded, setLoaded] = useState<Loaded | null>(null);

	const load = async () => {
		setLoading(true);
		setError(null);
		setLoaded(null);

		try {
			const fetched = await api.fetchBrandKit({ url });
			const kit = parseBrandKit(fetched.text, fetched.url, fetched.contentType);

			if (kit.kind === "error") setError(kit.message);
			else setLoaded({ ...kit, host: new URL(fetched.url).host });
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setLoading(false);
		}
	};

	const apply = () => {
		if (!loaded) return;

		if (loaded.kind === "design") onReplaceDesign(loaded.markdown);
		else onApplyTokens(loaded.tokens);
		onClose();
	};

	const count = loaded ? countOf(loaded.tokens) : 0;

	return (
		<>
			<DialogHeader>
				<DialogTitle className="text-base">Import from a URL</DialogTitle>
				<DialogDescription className="text-[13px]">
					A Design.md, a CSS theme or a JSON token file. GitHub file links work.
				</DialogDescription>
			</DialogHeader>
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					void load();
				}}
			>
				<Input
					value={url}
					onChange={(event) => setUrl(event.target.value)}
					placeholder="https://github.com/acme/brand/blob/main/DESIGN.md"
					aria-label="File address"
					aria-invalid={error !== null}
					aria-describedby={error ? "brand-import-error" : undefined}
					autoFocus
					spellCheck={false}
					className="h-8 text-[13px]"
				/>
				<Button type="submit" size="sm" variant="outline" disabled={loading || !url.trim()}>
					{loading ? <Loader2 className="animate-spin" /> : null}
					{loading ? "Loading" : "Load"}
				</Button>
			</form>
			{error ? (
				<p id="brand-import-error" role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
			{loaded?.kind === "design" ? (
				<p className="text-[13px] text-muted-foreground">
					{count
						? `A Design.md from ${loaded.host} with ${plural(count, "token")}. It replaces yours and re-themes the screens.`
						: `A Design.md from ${loaded.host} without a Tokens section. It replaces yours; then Update theme reads its tokens with AI.`}
				</p>
			) : null}
			{loaded?.kind === "tokens" ? (
				<p className="text-[13px] text-muted-foreground">
					{plural(count, "token")} from {loaded.host}. They go into DESIGN.md; the rest of the file stays.
				</p>
			) : null}
			{loaded && count ? <TokenPreview tokens={loaded.tokens} current={current} /> : null}
			<DialogFooter>
				<Button variant="outline" size="sm" onClick={onClose}>
					Cancel
				</Button>
				<Button size="sm" disabled={!loaded} onClick={apply}>
					{loaded?.kind === "design" ? "Replace DESIGN.md" : count ? `Apply ${plural(count, "token")}` : "Apply"}
				</Button>
			</DialogFooter>
		</>
	);
}

function LogoImport({
	request,
	current,
	onClose,
	onApplyTokens,
}: {
	request: Extract<BrandImport, { kind: "logo" }>;
	current: DesignTokens;
	onClose: () => void;
	onApplyTokens: (tokens: DesignTokens) => void;
}) {
	const { palette, image, name } = request;
	const [primary, setPrimary] = useState(palette.primary);
	const tokens = paletteTokens({ colors: palette.colors, primary });

	return (
		<>
			<DialogHeader>
				<DialogTitle className="text-base">Colors from {name}</DialogTitle>
				<DialogDescription className="text-[13px]">
					Pick the color for primary. Buttons, links and focus rings use it.
				</DialogDescription>
			</DialogHeader>
			<div className="flex items-center gap-3">
				<img
					src={image}
					alt=""
					className="size-12 shrink-0 rounded-md border bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:8px_8px] object-contain p-1"
				/>
				<div role="radiogroup" aria-label="Primary color" className="flex flex-wrap gap-1.5">
					{palette.colors.map((color) => (
						<button
							key={color}
							type="button"
							role="radio"
							aria-checked={color === primary}
							aria-label={color}
							title={color}
							onClick={() => setPrimary(color)}
							className={cn(
								"size-7 rounded-full border border-black/10 outline-none focus-visible:ring-2 focus-visible:ring-ring",
								color === primary && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
							)}
							style={{ backgroundColor: color }}
						/>
					))}
				</div>
			</div>
			<TokenPreview tokens={tokens} current={current} />
			<DialogFooter>
				<Button variant="outline" size="sm" onClick={onClose}>
					Cancel
				</Button>
				<Button
					size="sm"
					autoFocus
					onClick={() => {
						onApplyTokens(tokens);
						onClose();
					}}
				>
					Apply colors
				</Button>
			</DialogFooter>
		</>
	);
}

export function TokenPreview({ tokens, current }: { tokens: DesignTokens; current: DesignTokens }) {
	const rows = (["light", "dark"] as const).flatMap((mode) =>
		orderedTokenNames(tokens[mode]).map((name) => ({
			mode,
			name,
			value: tokens[mode][name]!,
			was: current[mode][name],
		})),
	);

	return (
		<ul className="-mx-1 max-h-56 overflow-y-auto rounded-md border py-1 font-mono text-[11px]">
			{rows.map(({ mode, name, value, was }) => (
				<li key={`${mode}:${name}`} className="flex h-6 items-center gap-2 px-2">
					{tokenKind(name) === "color" ? (
						<span
							aria-hidden
							className="size-3 shrink-0 rounded-sm border border-black/10"
							style={{ background: value }}
						/>
					) : (
						<span aria-hidden className="size-3 shrink-0" />
					)}
					<span className="min-w-0 flex-1 truncate">
						{name}
						{mode === "dark" ? <span className="text-subtle-foreground"> · dark</span> : null}
					</span>
					{was !== undefined && was !== value ? (
						<span className="max-w-24 truncate text-subtle-foreground line-through">{was}</span>
					) : null}
					<span className="max-w-[60%] truncate text-muted-foreground">{value}</span>
				</li>
			))}
		</ul>
	);
}
