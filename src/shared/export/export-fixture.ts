// A project that uses what generated screens use, for export tests and `hutch run check:exports`.

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { generateMockScreens } from "../mock-generator";
import type { Frame, ProjectFiles } from "../types";
import type { AppProjectInput } from "./app-project";

const UI_DIR = join(import.meta.dir, "../../mainview/components/ui");

/** Keyed like `UI_SOURCES`: `button`, `uai/search-field` */
export const fixtureUiSources: Record<string, string> = Object.fromEntries(
	readdirSync(UI_DIR, { recursive: true, encoding: "utf8" }).flatMap((file) =>
		file.endsWith(".tsx") ? [[file.replace(/\.tsx$/, ""), readFileSync(join(UI_DIR, file), "utf8")]] : [],
	),
);

const SETTINGS = `import { useState } from "react";
import { Bell, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Placeholder } from "@/components/ui/placeholder";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MetricCard, MetricCardLabel, MetricCardValue } from "@/components/ui/uai/metric-card";
import { SearchField, SearchFieldControl, SearchFieldInput } from "@/components/ui/uai/search-field";
import { ProfileRow } from "../components/profile-row";

export default function Settings() {
	const [alerts, setAlerts] = useState(true);

	return (
		<main className="min-h-screen bg-background p-gutter text-foreground">
			<header className="flex items-center justify-between">
				<h1 className="font-display text-display">Settings</h1>
				<Button variant="ghost" size="icon" data-link-to="back" aria-label="Back">
					<Bell />
				</Button>
			</header>
			<img src="/images/logo.png" alt="Logo" className="size-10 rounded-card" />
			<Placeholder kind="photo" subject="coffee" seed="settings" className="aspect-video w-full rounded-lg" />
			<SearchField>
				<SearchFieldControl>
					<Search />
					<SearchFieldInput placeholder="Search settings" />
				</SearchFieldControl>
			</SearchField>
			<Tabs defaultValue="account">
				<TabsList>
					<TabsTrigger value="account">Account</TabsTrigger>
					<TabsTrigger value="billing">Billing</TabsTrigger>
				</TabsList>
				<TabsContent value="account">
					<Card className="bg-brand/10">
						<CardHeader>
							<CardTitle>Account</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<ProfileRow name="Ana Lima" role="Owner" />
							<Label htmlFor="email">Email</Label>
							<Input id="email" defaultValue="ana@example.com" />
							<div className="flex items-center gap-2">
								<Switch checked={alerts} onCheckedChange={setAlerts} id="alerts" />
								<Label htmlFor="alerts">Alerts {alerts ? <Badge>On</Badge> : null}</Label>
							</div>
						</CardContent>
					</Card>
				</TabsContent>
				<TabsContent value="billing">
					<MetricCard>
						<MetricCardLabel>Plan</MetricCardLabel>
						<MetricCardValue>$12</MetricCardValue>
					</MetricCard>
				</TabsContent>
			</Tabs>
			<Dialog>
				<DialogTrigger asChild>
					<Button variant="destructive">Delete account</Button>
				</DialogTrigger>
				<DialogContent>
					<DialogTitle>Delete your account?</DialogTitle>
					<Avatar>
						<AvatarFallback>AL</AvatarFallback>
					</Avatar>
				</DialogContent>
			</Dialog>
		</main>
	);
}
`;

const PROFILE_ROW = `import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ProfileRowProps = { name: string; role: string; className?: string };

export function ProfileRow({ name, role, className }: ProfileRowProps) {
	return (
		<div className={cn("flex items-center justify-between rounded-card border p-3", className)}>
			<span className="font-medium">{name}</span>
			<Badge variant="secondary">{role}</Badge>
		</div>
	);
}
`;

function fixtureProject() {
	const mobile = generateMockScreens({ prompt: "A coffee club app", device: "mobile" });
	const desktop = generateMockScreens({ prompt: "A coffee club app", device: "desktop", existingFiles: [] });
	const files: ProjectFiles = {};

	for (const change of [...mobile.changes, ...desktop.changes])
		if (change.content !== null) files[change.path] = change.content;
	files["screens/settings.tsx"] = SETTINGS;
	files["components/profile-row.tsx"] = PROFILE_ROW;
	files["DESIGN.md"] = "# Design\n\n## Tokens\n\n- primary: #2563eb\n- color-brand: #e11d48\n";

	const settings: Frame = {
		file: "screens/settings.tsx",
		name: "Settings",
		device: "mobile",
		x: -500,
		y: 0,
		width: 390,
		height: 844,
	};

	return { files, frames: [...mobile.frames, ...desktop.frames, settings] };
}

/** One transparent pixel */
const LOGO_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export function exportFixture(): AppProjectInput {
	return {
		name: "Coffee Club",
		...fixtureProject(),
		theme: {
			light: {
				primary: "#2563eb",
				radius: "0.75rem",
				"color-brand": "#e11d48",
				"radius-card": "1rem",
				"font-display": '"Fraunces", serif',
				"text-display": "2rem/1.1",
				"spacing-gutter": "1.5rem",
			},
			dark: { "color-brand": "#fb7185" },
		},
		uiSources: fixtureUiSources,
		assets: { "/images/logo.png": LOGO_PNG },
	};
}
