import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { groupActions, hasChords } from "@/lib/action-groups";
import { type Action, formatChord } from "@/lib/actions";

type Gesture = { label: string; keys: string[]; pointer?: string };

/** Canvas input that isn't an action, from the README's "Canvas shortcuts" table */
const GESTURES: Gesture[] = [
	{ label: "Pan", keys: ["Space"], pointer: "drag" },
	{ label: "Pan", keys: [], pointer: "Scroll" },
	{ label: "Zoom", keys: ["⌘"], pointer: "scroll" },
	{ label: "Select an element", keys: ["⌘"], pointer: "click" },
	{ label: "Edit text in place", keys: [], pointer: "Double-click" },
	{ label: "Nudge the selected screens", keys: ["↑↓←→"] },
	{ label: "Nudge by 10", keys: ["⇧", "↑↓←→"] },
];

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	actions: readonly Action[];
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<li className="flex items-center justify-between gap-4 py-1 text-[13px]">
			<span className="truncate">{label}</span>
			<KbdGroup className="shrink-0 font-sans">{children}</KbdGroup>
		</li>
	);
}

/** `?`: every keyboard shortcut, read from the same actions the keys run */
export function ShortcutSheet({ open, onOpenChange, actions }: Props) {
	const groups = groupActions(actions, hasChords);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[80vh] grid-rows-[auto_minmax(0,1fr)] gap-0 p-0 sm:max-w-2xl">
				<DialogHeader className="border-b px-5 py-4">
					<DialogTitle className="text-sm">Keyboard shortcuts</DialogTitle>
					<DialogDescription className="text-xs">⌘ is Ctrl outside macOS.</DialogDescription>
				</DialogHeader>
				{/* Scrolls outside the columns: a capped height would spill extra columns sideways */}
				<div className="overflow-y-auto px-5 py-4">
					<div className="columns-2 gap-8">
						{groups.map(({ group, actions: members }) => (
							<section key={group} className="mb-4 break-inside-avoid">
								<h3 className="mb-1 text-xs font-medium text-muted-foreground">{group}</h3>
								<ul>
									{members.map((action) => (
										<Row key={action.id} label={action.label}>
											{/* ⌘= and ⌘+ both read ⌘+ */}
											{Array.from(new Set(action.chords?.map(formatChord)), (keys) => (
												<Kbd key={keys}>{keys}</Kbd>
											))}
										</Row>
									))}
								</ul>
							</section>
						))}
						<section className="mb-4 break-inside-avoid">
							<h3 className="mb-1 text-xs font-medium text-muted-foreground">Canvas</h3>
							<ul>
								{GESTURES.map((gesture) => (
									<Row key={`${gesture.label}-${gesture.pointer ?? ""}`} label={gesture.label}>
										{gesture.keys.map((keys) => (
											<Kbd key={keys}>{keys}</Kbd>
										))}
										{gesture.pointer && (
											<span className="text-xs text-muted-foreground">
												{gesture.keys.length > 0 && "+ "}
												{gesture.pointer}
											</span>
										)}
									</Row>
								))}
							</ul>
						</section>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
