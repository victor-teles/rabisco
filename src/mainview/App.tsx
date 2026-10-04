import { useState } from "react";
import { MODELS } from "@/components/app/design-composer";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/rpc";
import { EditorView } from "@/views/editor/editor";
import { HomeView, type StartDesign } from "@/views/home";

type Route =
	| { view: "home" }
	| { view: "editor"; projectPath: string; initialPrompt?: string; model: string };

function projectNameFromPrompt(prompt: string) {
	const words = prompt.trim().split(/\s+/).slice(0, 5).join(" ");
	if (!words) return "Untitled design";
	return words[0]!.toUpperCase() + words.slice(1);
}

export default function App() {
	const { theme, toggleTheme } = useTheme();
	const [route, setRoute] = useState<Route>({ view: "home" });

	const startDesign: StartDesign = async ({ prompt, device, model }) => {
		try {
			const project = await api.createProject({ name: projectNameFromPrompt(prompt), device });
			setRoute({ view: "editor", projectPath: project.path, initialPrompt: prompt || undefined, model });
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
					onOpenProject={(projectPath) => setRoute({ view: "editor", projectPath, model: MODELS[0].id })}
				/>
			) : (
				<EditorView
					key={route.projectPath}
					projectPath={route.projectPath}
					initialPrompt={route.initialPrompt}
					initialModel={route.model}
					theme={theme}
					onToggleTheme={toggleTheme}
					onBack={() => setRoute({ view: "home" })}
				/>
			)}
			<Toaster theme={theme} position="bottom-center" />
		</TooltipProvider>
	);
}
