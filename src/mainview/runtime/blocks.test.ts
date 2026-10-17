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
import { ActivityTimeline, ActivityTimelineContent, ActivityTimelineDate, ActivityTimelineEvent, ActivityTimelineEvents, ActivityTimelineGroup, ActivityTimelineTitle } from "@/components/ui/uai/activity-timeline";
import { AppHeader, AppHeaderAction, AppHeaderActions, AppHeaderBrand, AppHeaderNav, AppHeaderNavItem } from "@/components/ui/uai/app-header";
import { AppSidebar, AppSidebarItem, AppSidebarItemLabel, AppSidebarList, AppSidebarNav } from "@/components/ui/uai/app-sidebar";
import { Citation, CitationClaim, CitationPopover, CitationTitle, CitationTrigger } from "@/components/ui/uai/citation";
import { DescriptionList, DescriptionListDetails, DescriptionListItem, DescriptionListTerm } from "@/components/ui/uai/description-list";
import { EmptyState, EmptyStateAction, EmptyStateActions, EmptyStateContent, EmptyStateDescription, EmptyStateHeader, EmptyStateTitle } from "@/components/ui/uai/empty-state";
import { FileUpload, FileUploadDropzone, FileUploadInput, FileUploadItem, FileUploadList, FileUploadTrigger } from "@/components/ui/uai/file-upload";
import { FilterBar, FilterBarChip, FilterBarChips, FilterBarReset } from "@/components/ui/uai/filter-bar";
import { OrderStatus, OrderStatusBadge, OrderStatusHeader, OrderStatusProgress, OrderStatusStep, OrderStatusStepTitle, OrderStatusTitle } from "@/components/ui/uai/order-status";
import { PageTabs, PageTabsBar, PageTabsList, PageTabsPanel, PageTabsTab } from "@/components/ui/uai/page-tabs";
import { PricingToggle, PricingToggleList, PricingToggleOption, PricingTogglePrice } from "@/components/ui/uai/pricing-toggle";
import { ResponseStatus, ResponseStatusIndicator, ResponseStatusLabel } from "@/components/ui/uai/response-status";
import { SignInCard, SignInCardBody, SignInCardField, SignInCardFields, SignInCardHeader, SignInCardInput, SignInCardLabel, SignInCardSubmit, SignInCardTitle } from "@/components/ui/uai/sign-in-card";
import { TaskList, TaskListItem, TaskListTitle } from "@/components/ui/uai/task-list";
import { TestimonialCard, TestimonialCardAuthor, TestimonialCardName, TestimonialCardQuote } from "@/components/ui/uai/testimonial-card";
import { ToolCall, ToolCallHeader, ToolCallName, ToolCallTrigger } from "@/components/ui/uai/tool-call";
import { TrustPanel, TrustPanelLogo, TrustPanelLogos, TrustPanelRating } from "@/components/ui/uai/trust-panel";
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
			<AppHeader><AppHeaderBrand>Northwind</AppHeaderBrand><AppHeaderNav><AppHeaderNavItem href="#" active>Overview</AppHeaderNavItem></AppHeaderNav><AppHeaderActions><AppHeaderAction emphasis="primary">Invite</AppHeaderAction></AppHeaderActions></AppHeader>
			<AppSidebar defaultValue="inbox"><AppSidebarNav><AppSidebarList><AppSidebarItem value="inbox"><AppSidebarItemLabel>Inbox</AppSidebarItemLabel></AppSidebarItem></AppSidebarList></AppSidebarNav></AppSidebar>
			<PageTabs defaultValue="open"><PageTabsBar><PageTabsList><PageTabsTab value="open">Open</PageTabsTab><PageTabsTab value="closed">Closed</PageTabsTab></PageTabsList></PageTabsBar><PageTabsPanel value="open">Open tickets</PageTabsPanel></PageTabs>
			<FilterBar activeCount={1}><FilterBarChips><FilterBarChip onRemove={() => {}}>Status: open</FilterBarChip></FilterBarChips><FilterBarReset /></FilterBar>
			<DescriptionList><DescriptionListItem><DescriptionListTerm>Plan</DescriptionListTerm><DescriptionListDetails>Team</DescriptionListDetails></DescriptionListItem></DescriptionList>
			<ActivityTimeline><ActivityTimelineGroup><ActivityTimelineDate>Today</ActivityTimelineDate><ActivityTimelineEvents><ActivityTimelineEvent><ActivityTimelineContent><ActivityTimelineTitle>Invoice paid</ActivityTimelineTitle></ActivityTimelineContent></ActivityTimelineEvent></ActivityTimelineEvents></ActivityTimelineGroup></ActivityTimeline>
			<TaskList><TaskListItem status="active"><TaskListTitle>Connect your bank</TaskListTitle></TaskListItem></TaskList>
			<FileUpload><FileUploadDropzone><FileUploadInput /><FileUploadTrigger /></FileUploadDropzone><FileUploadList><FileUploadItem status="uploading" progress={64}>q3-report.pdf</FileUploadItem></FileUploadList></FileUpload>
			<SignInCard><SignInCardHeader><SignInCardTitle>Welcome back</SignInCardTitle></SignInCardHeader><SignInCardBody><SignInCardFields><SignInCardField><SignInCardLabel>Email</SignInCardLabel><SignInCardInput type="email" /></SignInCardField></SignInCardFields><SignInCardSubmit /></SignInCardBody></SignInCard>
			<OrderStatus><OrderStatusHeader><OrderStatusTitle>Order #4821</OrderStatusTitle><OrderStatusBadge tone="progress">Shipped</OrderStatusBadge></OrderStatusHeader><OrderStatusProgress><OrderStatusStep status="current"><OrderStatusStepTitle>In transit</OrderStatusStepTitle></OrderStatusStep></OrderStatusProgress></OrderStatus>
			<PricingToggle defaultValue="yearly"><PricingToggleList><PricingToggleOption value="monthly">Monthly</PricingToggleOption><PricingToggleOption value="yearly">Yearly</PricingToggleOption></PricingToggleList><PricingTogglePrice period="monthly">$12</PricingTogglePrice><PricingTogglePrice period="yearly">$120</PricingTogglePrice></PricingToggle>
			<TestimonialCard><TestimonialCardQuote>Cut our close by two days.</TestimonialCardQuote><TestimonialCardAuthor><TestimonialCardName>Ana Lima</TestimonialCardName></TestimonialCardAuthor></TestimonialCard>
			<TrustPanel><TrustPanelLogos><TrustPanelLogo name="Linear">Linear</TrustPanelLogo></TrustPanelLogos><TrustPanelRating value={4.8} /></TrustPanel>
			<EmptyState><EmptyStateContent><EmptyStateHeader><EmptyStateTitle>No invoices yet</EmptyStateTitle><EmptyStateDescription>Invoices you send show here.</EmptyStateDescription></EmptyStateHeader><EmptyStateActions><EmptyStateAction>New invoice</EmptyStateAction></EmptyStateActions></EmptyStateContent></EmptyState>
			<ToolCall status="success"><ToolCallHeader><ToolCallTrigger><ToolCallName>search_docs</ToolCallName></ToolCallTrigger></ToolCallHeader></ToolCall>
			<Citation index={1}><CitationClaim>Revenue grew 12%</CitationClaim><CitationTrigger /><CitationPopover><CitationTitle>Q3 report</CitationTitle></CitationPopover></Citation>
			<ResponseStatus status="streaming"><ResponseStatusIndicator /><ResponseStatusLabel>Writing</ResponseStatusLabel></ResponseStatus>
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
			"app-header",
			"app-sidebar",
			"page-tabs",
			"filter-bar",
			"description-list",
			"activity-timeline",
			"task-list",
			"file-upload",
			"sign-in-card",
			"order-status",
			"pricing-toggle",
			"testimonial-card",
			"trust-panel",
			"empty-state",
			"tool-call",
			"citation",
			"response-status",
		])
			expect(html).toContain(`data-slot="${slot}`);

		expect(html).toContain("$120");
		expect(html).not.toContain("$12<");

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
			".text-success-ink",
		])
			expect(css).toContain(rule);

		expect(css).toContain("--subtle-foreground: color-mix(in oklab, var(--muted-foreground) 75%, var(--background))");
		expect(css).toContain("--border-strong: color-mix(in oklab, var(--border), var(--foreground) 14%)");
		expect(css).toContain("--success-ink: color-mix(in oklab, var(--success) 80%, var(--foreground))");
		expect(css).toContain("--ease-out-quint: cubic-bezier(0.23, 1, 0.32, 1)");
	});
});
