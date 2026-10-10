import { useEffect, useState } from "react";
import { toast } from "sonner";
import { OnboardingDialog } from "@/components/app/onboarding-dialog";
import { SettingsDialog } from "@/components/app/settings-dialog";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadProviders } from "@/hooks/use-providers";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/rpc";
import { EditorView } from "@/views/editor/editor";
import { HomeView, type StartDesign } from "@/views/home";
import { AUTO_FALLBACK_STYLE, AUTO_STYLE } from "../shared/context/styles";

type Route =
	| { view: "home" }
	| {
			view: "editor";
			projectPath: string;
			initialPrompt?: string;
			initialFiles?: File[];
			initialVariations?: number;
			initialAutoStyle?: boolean;
	  };

function projectNameFromPrompt(prompt: string) {
	const words = prompt.trim().split(/\s+/).slice(0, 5).join(" ");

	if (!words) return "Untitled design";

	return words[0]!.toUpperCase() + words.slice(1);
}

export default function App() {
	const { theme, toggleTheme } = useTheme();
	const [route, setRoute] = useState<Route>({ view: "home" });

	useEffect(() => void loadProviders(), []);

	// useProject resets the Tailwind build with the project's candidates once its files load
	const openEditor = (next: Extract<Route, { view: "editor" }>) => setRoute(next);

	const startDesign: StartDesign = async ({ prompt, device, files, variations, style }) => {
		try {
			const auto = style === AUTO_STYLE && Boolean(prompt.trim());

			const project = await api.createProject({
				name: projectNameFromPrompt(prompt),
				device,
				style: auto ? null : style === AUTO_STYLE ? AUTO_FALLBACK_STYLE : style,
			});

			openEditor({
				view: "editor",
				projectPath: project.path,
				initialPrompt: prompt || undefined,
				initialFiles: files,
				initialVariations: variations,
				initialAutoStyle: auto || undefined,
			});
		} catch (error) {
			toast.error("Couldn't create the project", { description: String(error) });
		}
	};

	return (
		<TooltipProvider delayDuration={400}>
			{route.view === "home" ? (
				<HomeView
					theme={theme}
					onToggleTheme={toggleTheme}
					onStart={startDesign}
					onOpenProject={(projectPath) => openEditor({ view: "editor", projectPath })}
				/>
			) : (
				<EditorView
					key={route.projectPath}
					projectPath={route.projectPath}
					initialPrompt={route.initialPrompt}
					initialFiles={route.initialFiles}
					initialVariations={route.initialVariations}
					initialAutoStyle={route.initialAutoStyle}
					theme={theme}
					onToggleTheme={toggleTheme}
					onBack={() => setRoute({ view: "home" })}
				/>
			)}
			<SettingsDialog />
			<OnboardingDialog />
			<Toaster theme={theme} position="bottom-center" />
		</TooltipProvider>
	);
}
