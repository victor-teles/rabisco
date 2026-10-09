import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type FunctionComponent } from "react";
import { renderToString } from "react-dom/server";
import { UI_MODULES } from "../../shared/components/ui-modules";
import { extractCandidates } from "../lib/render/candidates";
import { compileSource } from "../lib/render/compile";
import { createCompiler, TailwindBuilder } from "../lib/render/tailwind";
import { externals } from "./externals";
import { ModuleRegistry } from "./registry";

const root = join(import.meta.dir, "../../..");

const blocks = Object.keys(UI_MODULES).filter((name) => name.startsWith("uai/"));

const SCREEN = `import { useState } from "react";
import { FormErrorSummary, FormErrorSummaryLink, FormErrorSummaryList, FormErrorSummaryTitle } from "@/components/ui/uai/form-error-summary";
import { FormField, FormFieldCount, FormFieldDescription, FormFieldInput, FormFieldLabel } from "@/components/ui/uai/form-field";
import { Message, MessageActions, MessageBody, MessageContent, MessageCopy } from "@/components/ui/uai/message";
import { MetricCard, MetricCardHeader, MetricCardLabel, MetricCardTrend, MetricCardValue } from "@/components/ui/uai/metric-card";
import { PromptComposer, PromptComposerActions, PromptComposerInput, PromptComposerSubmit } from "@/components/ui/uai/prompt-composer";
import { SearchField, SearchFieldClear, SearchFieldControl, SearchFieldInput, SearchFieldLabel } from "@/components/ui/uai/search-field";
import { StatusBanner, StatusBannerContent, StatusBannerIcon, StatusBannerTitle } from "@/components/ui/uai/status-banner";
import { StepIndicator, StepIndicatorStep, StepIndicatorTitle } from "@/components/ui/uai/step-indicator";
import { Thinking, ThinkingActivity, ThinkingContent, ThinkingTrigger } from "@/components/ui/uai/thinking";

export default function Dashboard() {
	const [query] = useState("refunds");
	return (
		<div className="grid gap-4 p-6">
			<MetricCard><MetricCardHeader><MetricCardLabel>Revenue</MetricCardLabel><MetricCardTrend direction="up">12%</MetricCardTrend></MetricCardHeader><MetricCardValue>$48,210</MetricCardValue></MetricCard>
			<StatusBanner tone="warning"><StatusBannerIcon /><StatusBannerContent><StatusBannerTitle>Trial ends soon</StatusBannerTitle></StatusBannerContent></StatusBanner>
			<StepIndicator><StepIndicatorStep status="current"><StepIndicatorTitle>Workspace</StepIndicatorTitle></StepIndicatorStep></StepIndicator>
			<SearchField defaultValue={query}><SearchFieldLabel>Search</SearchFieldLabel><SearchFieldControl><SearchFieldInput /><SearchFieldClear /></SearchFieldControl></SearchField>
			<FormField required maxLength={40} defaultValue="Acme"><FormFieldLabel>Company</FormFieldLabel><FormFieldInput /><FormFieldDescription>On invoices</FormFieldDescription><FormFieldCount /></FormField>
			<FormErrorSummary><FormErrorSummaryTitle /><FormErrorSummaryList><FormErrorSummaryLink fieldId="email">Enter an email</FormErrorSummaryLink></FormErrorSummaryList></FormErrorSummary>
			<Message from="assistant"><MessageBody><MessageContent>42 tickets this week</MessageContent><MessageActions><MessageCopy /></MessageActions></MessageBody></Message>
			<PromptComposer><PromptComposerInput placeholder="Ask anything" /><PromptComposerActions><PromptComposerSubmit /></PromptComposerActions></PromptComposer>
			<Thinking status="complete"><ThinkingTrigger duration="12s" /><ThinkingContent><ThinkingActivity type="search" query="refunds">Searched</ThinkingActivity></ThinkingContent></Thinking>
		</div>
	);
}
`;

describe("uai blocks in frames", () => {
	test("a screen renders every exposed block through the frame's module registry", () => {
		const compiled = compileSource("screens/dashboard.tsx", SCREEN);
		expect(compiled.error).toBeNull();

		const registry = new ModuleRegistry(externals);
		registry.apply({ "screens/dashboard.tsx": { source: SCREEN, code: compiled.code! } }, true);
		const Screen = registry.load("screens/dashboard.tsx").default;

		if (!(Screen instanceof Function)) throw new Error("No default export");
		// SAFETY: a screen default-exports a function component, and the check above made sure it is a function
		const html = renderToString(createElement(Screen as FunctionComponent));

		for (const slot of [
			"metric-card",
			"status-banner",
			"step-indicator",
			"search-field",
			"form-field",
			"form-error-summary",
			"message",
			"thinking",
		])
			expect(html).toContain(`data-slot="${slot}`);

		expect(html).toContain("$48,210");
		expect(html).toContain('placeholder="Ask anything"');
	});

	test("the screen above uses every exposed block", () => {
		for (const name of blocks) expect(SCREEN).toContain(`"@/components/ui/${name}"`);
	});

	test("the screen theme builds the classes inside the blocks", async () => {
		const stylesheets = {
			tailwindcss: readFileSync(join(root, "node_modules/tailwindcss/index.css"), "utf8"),
			"tw-animate-css": readFileSync(join(root, "node_modules/tw-animate-css/dist/tw-animate.css"), "utf8"),
		};

		const candidates = blocks.flatMap((name) =>
			extractCandidates(readFileSync(join(root, `src/mainview/components/ui/${name}.tsx`), "utf8")),
		);

		const builder = new TailwindBuilder(() => createCompiler(stylesheets), candidates);
		await builder.whenReady();
		const { css } = builder;

		// uai's own tokens and motion, which the shadcn theme alone doesn't have
		for (const rule of [
			".text-subtle-foreground",
			".bg-border-strong",
			".ease-out-quint",
			".shimmer-text",
			".animate-in",
			"--tone: var(--success)",
		])
			expect(css).toContain(rule);

		expect(css).toContain("--subtle-foreground: color-mix(in oklab, var(--muted-foreground) 75%, var(--background))");
		expect(css).toContain("--border-strong: color-mix(in oklab, var(--border), var(--foreground) 14%)");
		expect(css).toContain("--ease-out-quint: cubic-bezier(0.23, 1, 0.32, 1)");
	});
});
