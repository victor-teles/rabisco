import { memo, useMemo, useRef, useState } from "react";
import { Component, CornerUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Structure } from "@/hooks/use-structure";
import { componentRef, importedComponents } from "@/lib/outline";
import { componentSpec, extraAttributes, isVoidElement, readChildrenText, readProp, type PropValue } from "@/lib/props";
import { UI_SOURCES } from "@/lib/ui-sources";
import { cn } from "@/lib/utils";
import { cachedComponentApi } from "../../../shared/components/usages";
import { findElement, parseJsx, type JsxElement } from "../../../shared/jsx";
import { iconAt, swapIcon } from "../../../shared/jsx/icons";
import { isComponentFile } from "../../../shared/project";
import { linkHrefToScreen } from "../../../shared/prototype/links";
import type { Frame, ProjectFiles } from "../../../shared/types";
import { ElementStyle } from "./element-style";
import { IconPicker } from "./icon-picker";
import { PropControls, propSignature } from "./prop-controls";
import { ImagePickButton, ScreenLinkMenu } from "./prop-pickers";

type NodePropsProps = {
	files: ProjectFiles;
	file: string | null;
	structure: Structure;
	onEndStep: () => void;
	onOpenComponent?: (path: string) => void;
	/** For the screen picker of `href` */
	frames?: Frame[];
	/** Where a picked image is copied; without it `src` has no picker */
	projectPath?: string;
};

/** `src` on an `img`, or `src`/`image` on a component */
const isImageProp = (element: JsxElement, name: string) =>
	(name === "src" || name === "image") && (!element.intrinsic || element.name === "img");

const isLinkProp = (element: JsxElement, name: string) =>
	name === "href" && (!element.intrinsic || element.name === "a");

/** The attribute a tag is for, listed even before it is set */
const keyAttribute = (tag: string) => (tag === "img" ? "src" : tag === "a" ? "href" : undefined);

export const NodeProps = memo(function NodeProps({
	files,
	file,
	structure,
	onEndStep,
	onOpenComponent,
	frames,
	projectPath,
}: NodePropsProps) {
	const { node, nodes } = structure;

	if (file && node && node.file === file && files[file] !== undefined && nodes.length > 1) {
		return (
			<SeveralElements
				source={files[file]!}
				file={file}
				starts={nodes.map((n) => n.start)}
				structure={structure}
				onEndStep={onEndStep}
			/>
		);
	}

	if (file && node && node.file === file && files[file] !== undefined) {
		return (
			<ElementProps
				files={files}
				file={file}
				start={node.start}
				structure={structure}
				onEndStep={onEndStep}
				onOpenComponent={onOpenComponent}
				frames={frames}
				projectPath={projectPath}
			/>
		);
	}

	if (file && isComponentFile(file) && files[file] !== undefined)
		return <ComponentApiView path={file} source={files[file]!} />;

	return null;
});

function ElementProps({
	files,
	file,
	start,
	structure,
	onEndStep,
	onOpenComponent,
	frames = [],
	projectPath,
}: Omit<NodePropsProps, "file"> & { file: string; start: number }) {
	const source = files[file]!;
	const element = findElement(parseJsx(source), start);

	const ref = useMemo(
		() =>
			element && element.name && !element.intrinsic
				? componentRef(file, element.name, importedComponents(source))
				: null,
		[element, file, source],
	);

	const spec = componentSpec(ref, files, UI_SOURCES);
	const burst = useRef(0);
	// Not per element: editing hover styles across several elements keeps the state
	const [variant, setVariant] = useState("");

	if (!element) return null;

	const extra = extraAttributes(element, spec);
	const key = element.intrinsic && element.name ? keyAttribute(element.name) : undefined;

	if (key && !extra.includes(key)) extra.unshift(key);
	const values: Record<string, PropValue> = {};

	for (const name of [...(spec?.props.map((p) => p.name) ?? []), ...extra]) values[name] = readProp(element, name);

	const hasChildrenControl = spec
		? spec.acceptsChildren
		: element.name !== null && (!element.selfClosing || element.intrinsic) && !isVoidElement(element);

	const line = source.slice(0, start).split("\n").length;
	const target = { file, start };
	const step = (name: string) => `props:${file}:${start}:${name}:${burst.current}`;
	const icon = iconAt(source, start);
	const edit = (next: string | null) => next !== null && next !== source && structure.editCode(file, next);

	const adornment = (name: string) => {
		const value = values[name];

		if (isImageProp(element, name) && projectPath)
			return (
				<ImagePickButton
					projectPath={projectPath}
					disabled={structure.busy}
					onPicked={(src) => structure.setProp(target, name, src)}
				/>
			);

		if (isLinkProp(element, name))
			return (
				<ScreenLinkMenu
					files={files}
					frames={frames}
					file={file}
					href={value?.kind === "literal" ? String(value.value) : null}
					disabled={structure.busy}
					onPick={(screen) => edit(linkHrefToScreen(source, start, screen))}
				/>
			);

		return null;
	};

	const origin =
		ref?.source === "project"
			? ref.path
			: ref?.source === "ui"
				? `shadcn/ui · ${ref.module}`
				: ref?.module
					? `from ${ref.module}`
					: null;

	return (
		<>
			<section className="flex flex-col gap-2 border-b p-4">
				<div className="flex h-5 items-center gap-1.5">
					{ref ? <Component className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden /> : null}
					<h3
						className={cn(
							"min-w-0 truncate font-mono text-xs font-medium",
							ref ? "text-violet-700 dark:text-violet-300" : "text-foreground/80",
						)}
					>
						{element.name ?? "Fragment"}
					</h3>
					<span className="shrink-0 text-xs text-subtle-foreground tabular-nums">line {line}</span>
					<div className="flex-1" />
					{ref?.source === "project" && onOpenComponent ? (
						<Button
							variant="ghost"
							size="xs"
							className="-mr-1.5 text-muted-foreground"
							onClick={() => onOpenComponent(ref.path)}
							title={`Edit ${ref.path}; every screen that uses it updates`}
						>
							<CornerUpRight />
							Edit
						</Button>
					) : null}
				</div>
				{origin ? (
					<span className="-mt-1.5 truncate font-mono text-[11px] text-subtle-foreground" title={origin}>
						{origin}
					</span>
				) : null}
				{structure.busy && element.name !== null ? (
					<p className="-mt-1 text-xs text-subtle-foreground">Read-only while generating</p>
				) : null}
				{icon ? (
					<div className="flex min-h-8 items-center gap-2">
						<span className="w-[72px] shrink-0 truncate text-xs text-muted-foreground">Icon</span>
						<div className="flex min-w-0 flex-1 items-center">
							<IconPicker
								current={icon.imported}
								disabled={structure.busy}
								onPick={(name) => edit(swapIcon(source, start, name))}
							/>
						</div>
					</div>
				) : null}
				{element.name === null ? (
					<p className="text-xs text-subtle-foreground">A fragment has no props.</p>
				) : (
					<PropControls
						disabled={structure.busy}
						adornment={adornment}
						onAddAttribute={(name, value) => structure.setProp(target, name, value)}
						spec={spec}
						values={values}
						extra={extra}
						childrenText={hasChildrenControl ? readChildrenText(element) : undefined}
						onChange={(name, value, change) =>
							structure.setProp(target, name, value, change.spec, change.continuous ? step(name) : undefined)
						}
						onChildrenChange={(text, change) =>
							structure.setChildren(target, text, change.continuous ? step("children") : undefined)
						}
						onFieldFocus={() => {
							burst.current += 1;
						}}
						onFieldBlur={onEndStep}
					/>
				)}
			</section>
			{element.name === null ? null : (
				<ElementStyle
					key={`${file}:${start}`}
					source={source}
					start={start}
					disabled={structure.busy}
					onChange={(next, step) => structure.editCode(file, next, step)}
					onFieldFocus={() => {
						burst.current += 1;
					}}
					onFieldBlur={onEndStep}
					variant={variant}
					onVariantChange={setVariant}
				/>
			)}
		</>
	);
}

/** ⇧-click selected several elements: only the style edits that apply to all of them */
function SeveralElements({
	source,
	file,
	starts,
	structure,
	onEndStep,
}: {
	source: string;
	file: string;
	starts: number[];
	structure: Structure;
	onEndStep: () => void;
}) {
	const [variant, setVariant] = useState("");
	const tree = parseJsx(source);
	const elements = starts.flatMap((start) => findElement(tree, start) ?? []);
	const names = [...new Set(elements.map((element) => element.name ?? "Fragment"))];

	// The first in the file leads: edits after it never move it, so the controls keep focus while typing
	const [start, ...extras] = elements
		.flatMap((element) => (element.name === null ? [] : [element.start]))
		.sort((a, b) => a - b);

	return (
		<>
			<section className="flex flex-col gap-1 border-b p-4">
				<h3 className="text-xs font-medium text-foreground/80">{elements.length} elements</h3>
				<p className="truncate font-mono text-[11px] text-subtle-foreground" title={names.join(", ")}>
					{names.join(", ")}
				</p>
				{structure.busy ? <p className="text-xs text-subtle-foreground">Read-only while generating</p> : null}
			</section>
			{start === undefined ? null : (
				<ElementStyle
					key={file}
					source={source}
					start={start}
					extras={extras}
					disabled={structure.busy}
					onChange={(next, step) => structure.editCode(file, next, step)}
					onFieldBlur={onEndStep}
					variant={variant}
					onVariantChange={setVariant}
				/>
			)}
		</>
	);
}

function ComponentApiView({ path, source }: { path: string; source: string }) {
	const { exports } = cachedComponentApi(path, source);

	return (
		<section className="flex flex-col gap-3 border-b p-4">
			<h3 className="text-xs font-medium text-subtle-foreground">Component API</h3>
			{exports.length === 0 ? (
				<p className="text-xs text-subtle-foreground">No exported components found in {path}.</p>
			) : (
				exports.map((exp) => (
					<div key={exp.name} className="flex flex-col gap-1">
						<div className="flex items-center gap-1.5">
							<Component className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
							<span className="font-mono text-xs font-medium text-violet-700 dark:text-violet-300">{exp.name}</span>
						</div>
						{exp.props.length ? (
							<ul className="flex flex-col gap-0.5 pl-5">
								{exp.props.map((prop) => (
									<li
										key={prop.name}
										className="truncate font-mono text-[11px] text-muted-foreground"
										title={propSignature(prop)}
									>
										{propSignature(prop)}
									</li>
								))}
							</ul>
						) : (
							<p className="pl-5 text-xs text-subtle-foreground">No props.</p>
						)}
						{exp.acceptsChildren && !exp.props.some((p) => p.name === "children") ? (
							<p className="pl-5 font-mono text-[11px] text-subtle-foreground">children</p>
						) : null}
					</div>
				))
			)}
			<p className="text-xs text-subtle-foreground">Select an element in Code to edit its props.</p>
		</section>
	);
}
