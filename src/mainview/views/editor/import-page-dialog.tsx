import { useState, useSyncExternalStore } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/rpc";
import type { DesignTokens } from "../../../shared/context/tokens";
import { siteTokens } from "../../../shared/import/site-tokens";
import type { UrlCapture } from "../../../shared/import/url-capture";
import { FRAME_SIZE } from "../../../shared/project";
import type { Device } from "../../../shared/types";
import { TokenPreview } from "./brand-import-dialog";

export type PageImportRequest = {
	projectPath: string;
	device: Device;
	tokens: DesignTokens;
	importHtml: (html: string, device: Device) => Promise<void>;
	importCapture: (capture: UrlCapture, device: Device, theme: DesignTokens | null) => void;
};

let pending: PageImportRequest | null = null;

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
	listeners.add(listener);

	return () => void listeners.delete(listener);
};

function setPending(next: PageImportRequest | null) {
	pending = next;

	for (const listener of listeners) listener();
}

export function askPageImport(request: PageImportRequest) {
	setPending(request);
}

const DEVICES: { device: Device; label: string }[] = [
	{ device: "mobile", label: "Phone" },
	{ device: "tablet", label: "Tablet" },
	{ device: "desktop", label: "Desktop" },
];

const isDevice = (value: string): value is Device => DEVICES.some((entry) => entry.device === value);

export const looksLikeHtml = (text: string) => /<[a-z!][\s\S]*>/i.test(text.trim());

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

type Captured = { capture: UrlCapture; tokens: DesignTokens; host: string; copied: number; failed: number };

export function ImportPageDialog() {
	const request = useSyncExternalStore(subscribe, () => pending);

	const close = () => {
		void api.stopCapture({}).catch(() => undefined);
		setPending(null);
	};

	return (
		<Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
			<DialogContent className="sm:max-w-md" showCloseButton={false}>
				{request ? <ImportForm request={request} onClose={close} /> : null}
			</DialogContent>
		</Dialog>
	);
}

function ImportForm({ request, onClose }: { request: PageImportRequest; onClose: () => void }) {
	const [source, setSource] = useState("");
	const [device, setDevice] = useState(request.device);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [captured, setCaptured] = useState<Captured | null>(null);
	const [useSiteTheme, setUseSiteTheme] = useState(false);
	const html = looksLikeHtml(source);
	const width = FRAME_SIZE[device].width;

	const load = async () => {
		setLoading(true);
		setError(null);
		setCaptured(null);

		try {
			if (html) {
				await request.importHtml(source, device);

				return onClose();
			}

			const { capture, copied, failed } = await api.captureUrl({ path: request.projectPath, url: source, width });

			setCaptured({ capture, tokens: siteTokens(capture), host: new URL(capture.url).host, copied, failed });
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setLoading(false);
		}
	};

	const add = () => {
		if (!captured) return;
		request.importCapture(captured.capture, device, useSiteTheme ? captured.tokens : null);
		onClose();
	};

	if (captured) {
		const { capture, tokens, host, copied, failed } = captured;
		const images = copied + failed;

		return (
			<>
				<DialogHeader>
					<DialogTitle className="text-base">{capture.tree.title.trim() || host}</DialogTitle>
					<DialogDescription className="text-[13px]">
						{host}
						{images ? ` · ${plural(copied, "image")} copied${failed ? `, ${failed} left as placeholders` : ""}` : ""}
					</DialogDescription>
				</DialogHeader>
				<ToggleGroup
					type="single"
					size="sm"
					variant="outline"
					value={useSiteTheme ? "site" : "project"}
					onValueChange={(next) => next && setUseSiteTheme(next === "site")}
					aria-label="Theme"
					className="w-full"
				>
					<ToggleGroupItem value="project" className="flex-1 text-xs">
						Keep project theme
					</ToggleGroupItem>
					<ToggleGroupItem value="site" className="flex-1 text-xs">
						Use the site's theme
					</ToggleGroupItem>
				</ToggleGroup>
				{useSiteTheme ? (
					<>
						<p className="text-[13px] text-muted-foreground">
							{plural(Object.keys(tokens.light).length, "token")} go into DESIGN.md and re-theme every screen.
						</p>
						<TokenPreview tokens={tokens} current={request.tokens} />
					</>
				) : (
					<p className="text-[13px] text-muted-foreground">
						The screen uses your tokens where the site's values are close to them.
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button size="sm" autoFocus onClick={add}>
						Add screen
					</Button>
				</DialogFooter>
			</>
		);
	}

	return (
		<>
			<DialogHeader>
				<DialogTitle className="text-base">Import from HTML or URL</DialogTitle>
				<DialogDescription className="text-[13px]">
					A web address, or HTML you copied. You get an editable screen in its style.
				</DialogDescription>
			</DialogHeader>
			<form
				id="import-page-form"
				className="flex flex-col gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					void load();
				}}
			>
				<Textarea
					value={source}
					onChange={(event) => setSource(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || !html)) {
							event.preventDefault();
							event.currentTarget.form?.requestSubmit();
						}
					}}
					placeholder="https://example.com"
					aria-label="Web address or HTML"
					aria-invalid={error !== null}
					aria-describedby={error ? "import-page-error" : undefined}
					autoFocus
					spellCheck={false}
					disabled={loading}
					className="max-h-40 min-h-16 font-mono text-[13px]"
				/>
				<div className="flex items-center gap-3">
					<Label id="import-page-width" className="text-xs text-muted-foreground">
						Width
					</Label>
					<ToggleGroup
						type="single"
						size="sm"
						variant="outline"
						value={device}
						onValueChange={(next) => isDevice(next) && setDevice(next)}
						aria-labelledby="import-page-width"
						disabled={loading}
					>
						{DEVICES.map((entry) => (
							<ToggleGroupItem key={entry.device} value={entry.device} className="px-2 text-xs">
								{entry.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					<span className="text-xs text-subtle-foreground tabular-nums">{width} px</span>
				</div>
			</form>
			{error ? (
				<p id="import-page-error" role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
			{loading && !html ? (
				<p role="status" className="text-[13px] text-muted-foreground">
					Loading the page in a hidden window. This can take up to 15 seconds.
				</p>
			) : null}
			<DialogFooter>
				<Button variant="outline" size="sm" onClick={onClose}>
					{loading ? "Stop" : "Cancel"}
				</Button>
				<Button type="submit" form="import-page-form" size="sm" disabled={loading || !source.trim()}>
					{loading ? <Loader2 className="animate-spin" /> : null}
					{loading ? "Loading" : "Import"}
				</Button>
			</DialogFooter>
		</>
	);
}
