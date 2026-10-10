import { StyleChoices } from "@/components/app/style-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { StyleId } from "../../../shared/context/styles";

/** "Start from a style…" in the command palette: the empty chat's choices, wherever the chat is */
export function StyleDialog({
	open,
	onOpenChange,
	onPick,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPick: (id: StyleId) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-3 sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Start from a style</DialogTitle>
					<DialogDescription>Writes DESIGN.md with tokens and rules, and re-themes the screens.</DialogDescription>
				</DialogHeader>
				<StyleChoices
					className="-mx-2"
					onPick={(id) => {
						onOpenChange(false);
						onPick(id);
					}}
				/>
			</DialogContent>
		</Dialog>
	);
}
