import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronRight, ImagePlus, Loader2, Plus, Sparkles, Trash2, Type, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAssetImage } from "@/hooks/use-asset-image";
import { api, isDesktop } from "@/lib/rpc";
import { encodeBase64, projectAssets } from "@/lib/render/assets";
import { cn } from "@/lib/utils";
import { assetUsages, fontUsages, iconUsages } from "../../../shared/asset-usage";
import { assetType } from "../../../shared/assets";
import type { TokenUsage } from "../../../shared/context/token-usage";
import type { DesignTokens } from "../../../shared/context/tokens";
import { faceLabel, fontFamilies, fontToken, isFontSrc, type FontFamily } from "../../../shared/fonts";
import { isMoodboardSrc } from "../../../shared/moodboard";
import {
	findPlaceholders,
	imageName,
	placeholderDescription,
	placeholderImageRequest,
	type PlaceholderImage,
	type PlaceholderUse,
} from "../../../shared/placeholder-images";
import { isScreenFile, screenNameFromPath } from "../../../shared/project";
import type { Frame, ProjectFiles } from "../../../shared/types";

const FONT_ACCEPT = ".woff2,.woff,.ttf,.otf";

const NO_USE: TokenUsage = { count: 0, paths: [] };

const subscribeAssets = (listener: () => void) => projectAssets.subscribe(listener);

const srcsSnapshot = () => projectAssets.srcs();

type AssetsPanelProps = {
	projectPath: string;
	files: ProjectFiles;
	frames: Frame[];
	theme: DesignTokens;
	onOpenFile: (path: string) => void;
	onAddFontTokens: (families: FontFamily[]) => void;
	onRemoveAsset: (src: string) => void;
	onReplacePlaceholders: (images: PlaceholderImage[]) => void;
};

const usesLabel = (count: number) => (count ? `${count} ${count === 1 ? "use" : "uses"}` : "Unused");

const fileName = (src: string) => src.slice(src.lastIndexOf("/") + 1);

function Section({
	title,
	count,
	action,
	children,
}: {
	title: string;
	count: number;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-0.5 border-b pb-2 last:border-b-0">
			<header className="flex h-8 items-center gap-1.5 px-3">
				<h3 className="text-[12px] font-medium">{title}</h3>
				<span className="text-[11px] text-subtle-foreground tabular-nums">{count}</span>
				<div className="ml-auto flex items-center">{action}</div>
			</header>
			{children}
		</section>
	);
}

function HeaderAction({
	label,
	icon: Icon,
	busy,
	disabled,
	onClick,
}: {
	label: string;
	icon: LucideIcon;
	busy?: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					className="size-6 text-muted-foreground"
					aria-label={label}
					disabled={disabled || busy}
					onClick={onClick}
				>
					{busy ? <Loader2 className="animate-spin" /> : <Icon />}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

function UsageRow({
	preview,
	name,
	detail,
	usage,
	frames,
	onOpenFile,
	onRemove,
}: {
	preview: ReactNode;
	name: string;
	detail?: string;
	usage: TokenUsage;
	frames: Frame[];
	onOpenFile: (path: string) => void;
	onRemove?: () => void;
}) {
	const [open, setOpen] = useState(false);
	const names = new Map(frames.map((frame) => [frame.file, frame.name]));

	return (
		<div className="flex flex-col">
			<div className="group flex min-h-9 items-center gap-2 rounded-md px-2 hover:bg-accent/60">
				<button
					type="button"
					className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
					aria-expanded={open}
					disabled={!usage.count}
					onClick={() => setOpen((value) => !value)}
				>
					<ChevronRight
						className={cn(
							"size-3 shrink-0 text-subtle-foreground transition-transform",
							open && "rotate-90",
							!usage.count && "invisible",
						)}
					/>
					{preview}
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="truncate text-[13px]">{name}</span>
						{detail ? <span className="truncate text-[11px] text-subtle-foreground">{detail}</span> : null}
					</span>
					<span className="shrink-0 text-[11px] text-subtle-foreground tabular-nums">{usesLabel(usage.count)}</span>
				</button>
				{onRemove && !usage.count ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								className="size-6 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
								aria-label={`Delete ${name}`}
								onClick={onRemove}
							>
								<Trash2 />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">Delete</TooltipContent>
					</Tooltip>
				) : null}
			</div>
			{open ? (
				<ul className="flex flex-col pb-1 pl-9">
					{usage.paths.map((path) => (
						<li key={path}>
							<button
								type="button"
								className="w-full truncate rounded-sm px-2 py-0.5 text-left text-[12px] text-muted-foreground hover:bg-accent/60 hover:text-foreground"
								onClick={() => onOpenFile(path)}
							>
								{names.get(path) ?? path}
							</button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

function ImageThumb({ src }: { src: string }) {
	const { found, show } = useAssetImage(src);

	return (
		<span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-sm border bg-muted">
			{found ? <img ref={show} alt="" className="size-full object-cover" /> : null}
		</span>
	);
}

function usePreviewFonts(families: FontFamily[]) {
	useEffect(() => {
		const added: FontFace[] = [];
		const urls: string[] = [];

		for (const family of families) {
			for (const face of family.faces) {
				const blob = projectAssets.get(face.src);

				if (!blob) continue;
				const url = URL.createObjectURL(blob);

				const loaded = new FontFace(`rabisco-asset-${family.slug}`, `url("${url}")`, {
					weight: String(face.weight),
					style: face.style,
				});

				urls.push(url);
				added.push(loaded);
				document.fonts.add(loaded);
				loaded.load().catch(() => {});
			}
		}

		return () => {
			for (const face of added) document.fonts.delete(face);

			for (const url of urls) URL.revokeObjectURL(url);
		};
	}, [families]);
}

function useIconCatalog() {
	const [icons, setIcons] = useState<Record<string, LucideIcon> | null>(null);

	useEffect(() => {
		let live = true;

		void import("@/lib/icon-catalog").then(({ icons: catalog }) => {
			if (live) setIcons(catalog);
		});

		return () => {
			live = false;
		};
	}, []);

	return icons;
}

export const AssetsPanel = memo(function AssetsPanel({
	projectPath,
	files,
	frames,
	theme,
	onOpenFile,
	onAddFontTokens,
	onRemoveAsset,
	onReplacePlaceholders,
}: AssetsPanelProps) {
	const srcs = useSyncExternalStore(subscribeAssets, srcsSnapshot);
	const fontInput = useRef<HTMLInputElement>(null);
	const [addingImage, setAddingImage] = useState(false);
	const [addingFonts, setAddingFonts] = useState(false);
	const [canGenerate, setCanGenerate] = useState(false);
	const [generating, setGenerating] = useState<{ done: number; total: number } | null>(null);
	const [direction, setDirection] = useState("");
	const stopRef = useRef(false);
	const icons = useIconCatalog();

	useEffect(() => {
		let live = true;

		api
			.canGenerateImages({})
			.then(({ ok }) => live && setCanGenerate(ok))
			.catch(() => live && setCanGenerate(false));

		return () => {
			live = false;
		};
	}, []);

	const projectSrcs = useMemo(() => [...srcs].filter((src) => !isMoodboardSrc(src)).sort(), [srcs]);
	const images = useMemo(() => projectSrcs.filter((src) => assetType(src)?.startsWith("image/")), [projectSrcs]);
	const families = useMemo(() => fontFamilies(projectSrcs.filter(isFontSrc)), [projectSrcs]);
	const imageUses = useMemo(() => assetUsages(files, images), [files, images]);
	const fontUses = useMemo(() => fontUsages(files, theme, families), [files, theme, families]);
	const iconUses = useMemo(() => iconUsages(files), [files]);

	const placeholders = useMemo(
		() =>
			Object.entries(files)
				.filter(([path]) => isScreenFile(path))
				.flatMap(([path, source]) => findPlaceholders(path, source)),
		[files],
	);

	usePreviewFonts(families);

	const screenName = (path: string) => frames.find((frame) => frame.file === path)?.name ?? screenNameFromPath(path);

	const addImage = async () => {
		setAddingImage(true);

		try {
			const picked = await api.pickImage({ path: projectPath });

			if (picked) toast.success(`Added ${fileName(picked.src)}`);
		} catch (error) {
			toast.error("Couldn't add the image", { description: String(error) });
		} finally {
			setAddingImage(false);
		}
	};

	const addFonts = async (list: FileList | null) => {
		const picked = [...(list ?? [])];

		if (!picked.length) return;
		setAddingFonts(true);
		const added: string[] = [];

		for (const file of picked) {
			try {
				const data = await encodeBase64(file);
				const { src } = await api.addFont({ path: projectPath, name: file.name, data });
				projectAssets.apply([{ src, data }]);
				added.push(src);
			} catch (error) {
				toast.error(`Couldn't add ${file.name}`, {
					description: error instanceof Error ? error.message : String(error),
				});
			}
		}

		setAddingFonts(false);

		if (!added.length) return;
		const addedFamilies = fontFamilies(added);
		onAddFontTokens(addedFamilies);
		toast.success(`Added ${addedFamilies.map((family) => family.family).join(", ")}`, {
			description: `Use ${addedFamilies.map((family) => fontToken(family).name).join(", ")} in the Font family row.`,
		});
	};

	const generate = async (uses: PlaceholderUse[]) => {
		if (!uses.length || generating) return;
		stopRef.current = false;
		setGenerating({ done: 0, total: uses.length });
		const made: PlaceholderImage[] = [];
		const product = files["PRODUCT.md"];

		for (const use of uses) {
			if (stopRef.current) break;

			try {
				const request = placeholderImageRequest(use, { screen: screenName(use.path), product }, direction);
				const { src, data } = await api.generateImage({ path: projectPath, ...request, name: imageName(use) });
				projectAssets.apply([{ src, data }]);
				made.push({ use, src });
			} catch (error) {
				toast.error("Couldn't make the image", { description: error instanceof Error ? error.message : String(error) });

				break;
			} finally {
				setGenerating((value) => value && { ...value, done: value.done + 1 });
			}
		}

		setGenerating(null);

		if (made.length) onReplacePlaceholders(made);
	};

	const generateHint = canGenerate
		? "Replace with an AI image"
		: "Add a provider with an image model in Settings to make images";

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
			<Section
				title="Images"
				count={images.length}
				action={
					<HeaderAction
						label={isDesktop ? "Add image" : "Adding images needs the desktop app"}
						icon={ImagePlus}
						busy={addingImage}
						disabled={!isDesktop}
						onClick={() => void addImage()}
					/>
				}
			>
				{images.length ? (
					<div className="flex flex-col px-1">
						{images.map((src) => (
							<UsageRow
								key={src}
								preview={<ImageThumb src={src} />}
								name={fileName(src)}
								usage={imageUses.get(src) ?? NO_USE}
								frames={frames}
								onOpenFile={onOpenFile}
								onRemove={isDesktop ? () => onRemoveAsset(src) : undefined}
							/>
						))}
					</div>
				) : (
					<p className="px-3 text-[12px] text-subtle-foreground">Images in public/ show here.</p>
				)}
			</Section>

			<Section
				title="Placeholders"
				count={placeholders.length}
				action={
					placeholders.length ? (
						<HeaderAction
							label={canGenerate ? "Replace all with AI images" : generateHint}
							icon={Sparkles}
							busy={generating !== null}
							disabled={!canGenerate}
							onClick={() => void generate(placeholders)}
						/>
					) : null
				}
			>
				{placeholders.length ? (
					<div className="flex flex-col gap-1 px-1">
						<Input
							value={direction}
							onChange={(event) => setDirection(event.target.value)}
							placeholder="Art direction, e.g. warm film photos"
							aria-label="Art direction for generated images"
							className="mx-2 h-7 w-auto text-[12px] md:text-[12px]"
						/>
						{generating ? (
							<div className="flex items-center gap-2 px-2 text-[12px] text-muted-foreground">
								<Loader2 className="size-3.5 animate-spin" />
								<span className="flex-1 tabular-nums">
									Making image {Math.min(generating.done + 1, generating.total)} of {generating.total}
								</span>
								<Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => (stopRef.current = true)}>
									Stop
								</Button>
							</div>
						) : null}
						{placeholders.map((use) => (
							<div
								key={`${use.path}:${use.start}`}
								className="group flex min-h-8 items-center gap-2 rounded-md px-2 hover:bg-accent/60"
							>
								<button
									type="button"
									className="flex min-w-0 flex-1 flex-col py-1 text-left"
									onClick={() => onOpenFile(use.path)}
								>
									<span className="truncate text-[13px]">{placeholderDescription(use)}</span>
									<span className="truncate text-[11px] text-subtle-foreground">{screenName(use.path)}</span>
								</button>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon-sm"
											className="size-6 text-muted-foreground"
											aria-label={`${generateHint}: ${placeholderDescription(use)}`}
											disabled={!canGenerate || generating !== null}
											onClick={() => void generate([use])}
										>
											<Sparkles />
										</Button>
									</TooltipTrigger>
									<TooltipContent side="bottom">{generateHint}</TooltipContent>
								</Tooltip>
							</div>
						))}
					</div>
				) : (
					<p className="px-3 text-[12px] text-subtle-foreground">No photo or illustration placeholders.</p>
				)}
			</Section>

			<Section
				title="Fonts"
				count={families.length}
				action={
					<HeaderAction label="Add font" icon={Plus} busy={addingFonts} onClick={() => fontInput.current?.click()} />
				}
			>
				<input
					ref={fontInput}
					type="file"
					accept={FONT_ACCEPT}
					multiple
					hidden
					data-testid="font-input"
					onChange={(event) => {
						void addFonts(event.target.files);
						event.target.value = "";
					}}
				/>
				{families.length ? (
					<div className="flex flex-col px-1">
						{families.map((family) => {
							const usage = fontUses.get(family.slug);

							return (
								<UsageRow
									key={family.slug}
									preview={
										<span
											className="grid size-7 shrink-0 place-items-center rounded-sm border text-[14px]"
											style={{ fontFamily: `"rabisco-asset-${family.slug}", var(--font-sans)` }}
										>
											Aa
										</span>
									}
									name={family.family}
									detail={[family.faces.map(faceLabel).join(", "), ...(usage?.tokens ?? [])].join(" · ")}
									usage={usage ?? NO_USE}
									frames={frames}
									onOpenFile={onOpenFile}
									onRemove={
										isDesktop
											? () => {
													for (const face of family.faces) onRemoveAsset(face.src);
												}
											: undefined
									}
								/>
							);
						})}
					</div>
				) : (
					<p className="px-3 text-[12px] text-subtle-foreground">
						Add woff2, woff, ttf or otf files. Each family gets a font token.
					</p>
				)}
			</Section>

			<Section title="Icons" count={iconUses.length}>
				{iconUses.length ? (
					<div className="flex flex-col px-1">
						{iconUses.map((icon) => {
							const Icon = icons?.[icon.name] ?? Type;

							return (
								<UsageRow
									key={icon.name}
									preview={
										<span className="grid size-7 shrink-0 place-items-center rounded-sm border text-muted-foreground">
											<Icon className="size-4" />
										</span>
									}
									name={icon.name}
									usage={icon}
									frames={frames}
									onOpenFile={onOpenFile}
								/>
							);
						})}
					</div>
				) : (
					<p className="px-3 text-[12px] text-subtle-foreground">No lucide icons yet.</p>
				)}
			</Section>
		</div>
	);
});
