import { InspectorSection } from "@/components/app/inspector-section";
import { Button } from "@/components/ui/button";
import { DEVICE_PRESETS, PRESET_KINDS, type DevicePreset } from "@/lib/device-presets";

export function FramePresets({ onPick }: { onPick: (preset: DevicePreset) => void }) {
	return (
		<div className="flex flex-col gap-4 border-b p-4">
			<p className="text-[13px] text-subtle-foreground">
				Drag on the canvas for a new screen, or inside a screen for a box. Or pick a size.
			</p>
			{PRESET_KINDS.map(({ kind, label }) => (
				<InspectorSection key={kind} title={label}>
					<div className="flex flex-col">
						{DEVICE_PRESETS.map((preset) =>
							preset.kind === kind ? (
								<Button
									key={preset.id}
									variant="ghost"
									size="sm"
									className="h-7 justify-between px-2 text-[13px] font-normal"
									onClick={() => onPick(preset)}
								>
									{preset.label}
									<span className="text-xs text-muted-foreground tabular-nums">
										{preset.width} × {preset.height}
									</span>
								</Button>
							) : null,
						)}
					</div>
				</InspectorSection>
			))}
		</div>
	);
}
