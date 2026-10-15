import { useState } from "react";
import { X } from "lucide-react";
import { InspectorSection } from "@/components/app/inspector-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TokenMode } from "../../../shared/context/token-edit";
import {
	modeOptionError,
	orderedTokenNames,
	tokenKind,
	validateToken,
	type DesignTokens,
	type TokenValues,
} from "../../../shared/context/tokens";
import { groupLabel, hasDraft } from "../../../shared/modes";
import type { CanvasSection } from "../../../shared/types";
import { FIELD, ROW, TokenField } from "./token-fields";

const SCHEMES: TokenMode[] = ["light", "dark"];

type Props = {
	section: CanvasSection;
	theme: DesignTokens;
	design: string;
	onDraft: (id: string, scheme: keyof TokenValues, name: string, value: string | null) => void;
	onSaveAsMode: (id: string, group: string, option: string) => void;
	onApply: (id: string) => void;
	onDiscard: (id: string) => void;
};

export function SectionDraft({ section, theme, design, onDraft, onSaveAsMode, onApply, onDiscard }: Props) {
	const [saving, setSaving] = useState(false);
	const draft = section.tokens;
	const names = orderedTokenNames(theme.light, theme.dark, draft?.light ?? {}, draft?.dark ?? {});

	return (
		<InspectorSection title="Section tokens">
			<p className="text-[11px]/4 text-pretty text-subtle-foreground">
				Changes show only on the screens in this section until you save or discard them.
			</p>
			{names.length ? (
				<div className="-mx-1.5 flex flex-col" role="list" aria-label="Section tokens">
					<div className={cn(ROW, "pb-0.5 text-[10px] font-medium text-subtle-foreground uppercase")} aria-hidden>
						<span className="px-1.5">Name</span>
						<span className="px-1.5">Light</span>
						<span className="px-1.5">Dark</span>
					</div>
					{names.map((name) => (
						<DraftRow
							key={name}
							name={name}
							theme={theme}
							draft={draft}
							onSet={(scheme, value) => onDraft(section.id, scheme, name, value)}
						/>
					))}
				</div>
			) : (
				<p className="text-[11px]/4 text-pretty text-subtle-foreground">DESIGN.md has no tokens yet.</p>
			)}
			{hasDraft(draft) ? (
				saving ? (
					<SaveAsModeForm
						section={section}
						theme={theme}
						design={design}
						onSave={(group, option) => {
							setSaving(false);
							onSaveAsMode(section.id, group, option);
						}}
						onClose={() => setSaving(false)}
					/>
				) : (
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" size="sm" onClick={() => setSaving(true)}>
							Save as mode
						</Button>
						<Button variant="outline" size="sm" onClick={() => onApply(section.id)}>
							Apply to project
						</Button>
						<Button variant="ghost" size="sm" onClick={() => onDiscard(section.id)}>
							Discard
						</Button>
					</div>
				)
			) : null}
		</InspectorSection>
	);
}

function DraftRow({
	name,
	theme,
	draft,
	onSet,
}: {
	name: string;
	theme: DesignTokens;
	draft: TokenValues | undefined;
	onSet: (scheme: TokenMode, value: string | null) => void;
}) {
	const [error, setError] = useState<string | null>(null);
	const drafted = SCHEMES.some((scheme) => draft?.[scheme][name] !== undefined);

	const setValue = (scheme: TokenMode) => (value: string) => {
		const reason = value ? validateToken(name, value) : null;

		if (!reason) onSet(scheme, value || null);

		return reason;
	};

	return (
		<div role="listitem" className="group flex flex-col py-px">
			<div className={ROW}>
				<span
					className={cn(
						"truncate px-1.5 py-1 font-mono text-[11px]",
						drafted ? "text-foreground" : "text-muted-foreground",
					)}
					title={name}
				>
					{name}
				</span>
				{SCHEMES.map((scheme) => (
					<TokenField
						key={scheme}
						label={`${name} ${scheme} value in this section`}
						value={draft?.[scheme][name] ?? ""}
						placeholder={theme[scheme][name] ?? ""}
						swatch={tokenKind(name) === "color"}
						invalid={error !== null}
						onCommit={setValue(scheme)}
						onError={setError}
					/>
				))}
				{drafted ? (
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={`Reset ${name}`}
						title={`Reset ${name}`}
						className="text-muted-foreground"
						onClick={() => SCHEMES.forEach((scheme) => draft?.[scheme][name] !== undefined && onSet(scheme, null))}
					>
						<X />
					</Button>
				) : null}
			</div>
			{error ? <p className="px-1.5 pb-1 text-[11px]/4 text-pretty text-destructive">{error}</p> : null}
		</div>
	);
}

function SaveAsModeForm({
	section,
	theme,
	design,
	onSave,
	onClose,
}: {
	section: CanvasSection;
	theme: DesignTokens;
	design: string;
	onSave: (group: string, option: string) => void;
	onClose: () => void;
}) {
	const firstGroup = theme.modes?.[0]?.name;
	const [group, setGroup] = useState(firstGroup ? groupLabel(firstGroup) : "");
	const [option, setOption] = useState(section.name);
	const [error, setError] = useState<string | null>(null);

	const submit = () => {
		const reason = modeOptionError(design, group, option);

		if (reason) setError(reason);
		else onSave(group, option);
	};

	return (
		<form
			aria-label="Save as mode"
			className="flex flex-col gap-1.5"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					onClose();
				}
			}}
		>
			<div className="grid grid-cols-2 gap-1.5">
				<Input
					value={group}
					placeholder="Group, e.g. Brand"
					aria-label="Mode group"
					autoFocus={!group}
					spellCheck={false}
					className={cn(FIELD, "border-input")}
					onChange={(event) => {
						setGroup(event.target.value);
						setError(null);
					}}
				/>
				<Input
					value={option}
					placeholder="Mode, e.g. Acme"
					aria-label="Mode name"
					autoFocus={!!group}
					spellCheck={false}
					className={cn(FIELD, "border-input")}
					onChange={(event) => {
						setOption(event.target.value);
						setError(null);
					}}
				/>
			</div>
			{error ? <p className="text-[11px]/4 text-pretty text-destructive">{error}</p> : null}
			<div className="flex gap-2">
				<Button type="submit" size="sm">
					Save
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={onClose}>
					Cancel
				</Button>
			</div>
		</form>
	);
}
