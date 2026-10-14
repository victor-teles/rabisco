import { useEffect, useState } from "react";
import { toast } from "sonner";
import { OnboardingDialog } from "@/components/app/onboarding-dialog";
import { SettingsDialog } from "@/components/app/settings-dialog";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadProviders } from "@/hooks/use-providers";
import { useTheme } from "@/hooks/use-theme";
import { agentOpener } from "@/lib/agent-open";
import { api, onOpenRequested, onSitesExpired } from "@/lib/rpc";
import { projectSessions } from "@/lib/sessions";
import { forgetProject, readLastProject } from "@/lib/workspace";
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
			initialChatId?: string;
	  };

function projectNameFromPrompt(prompt: string) {
	const words = prompt.trim().split(/\s+/).slice(0, 5).join(" ");

	if (!words) return "Untitled design";

	return words[0]!.toUpperCase() + words.slice(1);
}

export default function App() {
	const { theme, toggleTheme } = useTheme();

	const [route, setRoute] = useState<Route>(() => {
		const last = readLastProject(localStorage);

		return last
			? { view: "editor", projectPath: last.path, initialChatId: last.chatId ?? undefined }
			: { view: "home" };
	});

	useEffect(() => void loadProviders(), []);

	useEffect(
		() =>
			projectSessions.onLanded(({ path, name, outcome }) => {
				const action = { label: "Open", onClick: () => setRoute({ view: "editor", projectPath: path }) };

				if (outcome === "ready") toast(`Screens for ${name} are ready`, { action });
				else if (outcome === "failed") toast.error(`Couldn't finish ${name}`, { action });
				else toast(`Plan for ${name} is ready to review`, { action });
			}),
		[],
	);

	// useProject resets the Tailwind build with the project's candidates once its files load
	const openEditor = (next: Extract<Route, { view: "editor" }>) => setRoute(next);

	useEffect(() => agentOpener.handleOpen((projectPath) => setRoute({ view: "editor", projectPath })), []);

	useEffect(() => {
		const take = () =>
			api
				.takeOpenRequest({})
				.then(({ path }) => path && setRoute({ view: "editor", projectPath: path }))
				.catch((error) => console.warn("Could not read the open request:", error));

		void take();

		return onOpenRequested(() => void take());
	}, []);

	useEffect(() => {
		const take = () =>
			api
				.takeExpiredSites({})
				.then(({ urls }) => {
					if (urls.length > 0)
						toast(urls.length === 1 ? "Removed 1 expired site" : `Removed ${urls.length} expired sites`, {
							description: "Their links don't work anymore.",
						});
				})
				.catch((error) => console.warn("Could not read the expired sites:", error));

		void take();

		return onSitesExpired(() => void take());
	}, []);

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
					initialChatId={route.initialChatId}
					theme={theme}
					onToggleTheme={toggleTheme}
					onBack={() => {
						forgetProject(localStorage);
						setRoute({ view: "home" });
					}}
				/>
			)}
			<SettingsDialog />
			<OnboardingDialog />
			<Toaster theme={theme} position="bottom-center" />
		</TooltipProvider>
	);
}
