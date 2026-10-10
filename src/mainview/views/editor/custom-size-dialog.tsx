import { useState, useSyncExternalStore } from "react";
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
import { parseSize, type Size } from "@/lib/device-presets";

/** The open request: what to do with the size once it's picked */
let pending: ((size: Size) => void) | null = null;

/** The next dialog starts from the last size used */
let lastSize: Size = { width: 1024, height: 768 };

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
	listeners.add(listener);

	return () => void listeners.delete(listener);
};

function setPending(next: ((size: Size) => void) | null) {
	pending = next;

	for (const listener of listeners) listener();
}

/** Asks for a frame size; `create` runs only if the user confirms one */
export function askCustomSize(create: (size: Size) => void) {
	setPending(create);
}

/** Mounted once in the editor; the "Custom size…" action opens it */
export function CustomSizeDialog() {
	const request = useSyncExternalStore(subscribe, () => pending);

	return (
		<Dialog open={request !== null} onOpenChange={(open) => !open && setPending(null)}>
			<DialogContent className="sm:max-w-xs">
				{/* Mounted per request, so the fields start from the last size */}
				{request ? <SizeForm create={request} /> : null}
			</DialogContent>
		</Dialog>
	);
}

function SizeForm({ create }: { create: (size: Size) => void }) {
	const [width, setWidth] = useState(String(lastSize.width));
	const [height, setHeight] = useState(String(lastSize.height));
	const size = parseSize(width, height);

	const submit = (event: React.FormEvent) => {
		event.preventDefault();

		if (!size) return;
		lastSize = size;
		setPending(null);
		create(size);
	};

	return (
		<form onSubmit={submit} className="grid gap-4">
			<DialogHeader>
				<DialogTitle>New screen</DialogTitle>
				<DialogDescription>Pick a size in pixels. You can resize the frame later.</DialogDescription>
			</DialogHeader>
			<div className="grid grid-cols-2 gap-2">
				<label className="grid gap-1 text-xs text-muted-foreground">
					Width
					<Input
						autoFocus
						inputMode="numeric"
						value={width}
						onChange={(event) => setWidth(event.target.value)}
						aria-invalid={size === null}
					/>
				</label>
				<label className="grid gap-1 text-xs text-muted-foreground">
					Height
					<Input
						inputMode="numeric"
						value={height}
						onChange={(event) => setHeight(event.target.value)}
						aria-invalid={size === null}
					/>
				</label>
			</div>
			<DialogFooter>
				<Button type="button" variant="ghost" onClick={() => setPending(null)}>
					Cancel
				</Button>
				<Button type="submit" disabled={!size}>
					Create
				</Button>
			</DialogFooter>
		</form>
	);
}
