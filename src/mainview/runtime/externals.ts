import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as Cva from "class-variance-authority";
import * as Clsx from "clsx";
import * as TailwindMerge from "tailwind-merge";
import * as Utils from "@/lib/utils";
import * as Avatar from "@/components/ui/avatar";
import * as Badge from "@/components/ui/badge";
import * as Button from "@/components/ui/button";
import * as Card from "@/components/ui/card";
import * as Collapsible from "@/components/ui/collapsible";
import * as Dialog from "@/components/ui/dialog";
import * as DropdownMenu from "@/components/ui/dropdown-menu";
import * as Input from "@/components/ui/input";
import * as Kbd from "@/components/ui/kbd";
import * as Label from "@/components/ui/label";
import * as Placeholder from "@/components/ui/placeholder";
import * as Popover from "@/components/ui/popover";
import * as Progress from "@/components/ui/progress";
import * as ScrollArea from "@/components/ui/scroll-area";
import * as Separator from "@/components/ui/separator";
import * as Tabs from "@/components/ui/tabs";
import * as Textarea from "@/components/ui/textarea";
import * as Toggle from "@/components/ui/toggle";
import * as ToggleGroup from "@/components/ui/toggle-group";
import * as Tooltip from "@/components/ui/tooltip";
import * as ActivityTimeline from "@/components/ui/uai/activity-timeline";
import * as AppHeader from "@/components/ui/uai/app-header";
import * as AppSidebar from "@/components/ui/uai/app-sidebar";
import * as Citation from "@/components/ui/uai/citation";
import * as DescriptionList from "@/components/ui/uai/description-list";
import * as EmptyState from "@/components/ui/uai/empty-state";
import * as FileUpload from "@/components/ui/uai/file-upload";
import * as FilterBar from "@/components/ui/uai/filter-bar";
import * as FormErrorSummary from "@/components/ui/uai/form-error-summary";
import * as FormField from "@/components/ui/uai/form-field";
import * as Message from "@/components/ui/uai/message";
import * as MetricCard from "@/components/ui/uai/metric-card";
import * as OrderStatus from "@/components/ui/uai/order-status";
import * as PageTabs from "@/components/ui/uai/page-tabs";
import * as PricingToggle from "@/components/ui/uai/pricing-toggle";
import * as PromptComposer from "@/components/ui/uai/prompt-composer";
import * as ResponseStatus from "@/components/ui/uai/response-status";
import * as SearchField from "@/components/ui/uai/search-field";
import * as SignInCard from "@/components/ui/uai/sign-in-card";
import * as StatusBanner from "@/components/ui/uai/status-banner";
import * as StepIndicator from "@/components/ui/uai/step-indicator";
import * as TaskList from "@/components/ui/uai/task-list";
import * as TestimonialCard from "@/components/ui/uai/testimonial-card";
import * as Thinking from "@/components/ui/uai/thinking";
import * as ToolCall from "@/components/ui/uai/tool-call";
import * as TrustPanel from "@/components/ui/uai/trust-panel";
import { frameAssets } from "./assets";
import { lucide, phosphor, tabler } from "./icons";
import { refresh } from "./refresh";

type Jsx = typeof JsxRuntime.jsx;

/** Screens write `src="/images/a.png"`; the frame loads the bytes the host posted (decision 0010) */
const resolvingAssets =
	(jsx: Jsx): Jsx =>
	(type, props, key) =>
		jsx(type, frameAssets.props(props), key);

const jsxRuntime = { ...JsxRuntime, jsx: resolvingAssets(JsxRuntime.jsx), jsxs: resolvingAssets(JsxRuntime.jsxs) };

export const externals = {
	react: React,
	"react/jsx-runtime": jsxRuntime,
	"react-dom": ReactDOM,
	"react-dom/client": ReactDOMClient,
	"lucide-react": lucide,
	"@tabler/icons-react": tabler,
	"@phosphor-icons/react": phosphor,
	"class-variance-authority": Cva,
	clsx: Clsx,
	"tailwind-merge": TailwindMerge,
	"@/lib/utils": Utils,
	"@/components/ui/avatar": Avatar,
	"@/components/ui/badge": Badge,
	"@/components/ui/button": Button,
	"@/components/ui/card": Card,
	"@/components/ui/collapsible": Collapsible,
	"@/components/ui/dialog": Dialog,
	"@/components/ui/dropdown-menu": DropdownMenu,
	"@/components/ui/input": Input,
	"@/components/ui/kbd": Kbd,
	"@/components/ui/label": Label,
	"@/components/ui/placeholder": Placeholder,
	"@/components/ui/popover": Popover,
	"@/components/ui/progress": Progress,
	"@/components/ui/scroll-area": ScrollArea,
	"@/components/ui/separator": Separator,
	"@/components/ui/tabs": Tabs,
	"@/components/ui/textarea": Textarea,
	"@/components/ui/toggle": Toggle,
	"@/components/ui/toggle-group": ToggleGroup,
	"@/components/ui/tooltip": Tooltip,
	"@/components/ui/uai/activity-timeline": ActivityTimeline,
	"@/components/ui/uai/app-header": AppHeader,
	"@/components/ui/uai/app-sidebar": AppSidebar,
	"@/components/ui/uai/citation": Citation,
	"@/components/ui/uai/description-list": DescriptionList,
	"@/components/ui/uai/empty-state": EmptyState,
	"@/components/ui/uai/file-upload": FileUpload,
	"@/components/ui/uai/filter-bar": FilterBar,
	"@/components/ui/uai/form-error-summary": FormErrorSummary,
	"@/components/ui/uai/form-field": FormField,
	"@/components/ui/uai/message": Message,
	"@/components/ui/uai/metric-card": MetricCard,
	"@/components/ui/uai/order-status": OrderStatus,
	"@/components/ui/uai/page-tabs": PageTabs,
	"@/components/ui/uai/pricing-toggle": PricingToggle,
	"@/components/ui/uai/prompt-composer": PromptComposer,
	"@/components/ui/uai/response-status": ResponseStatus,
	"@/components/ui/uai/search-field": SearchField,
	"@/components/ui/uai/sign-in-card": SignInCard,
	"@/components/ui/uai/status-banner": StatusBanner,
	"@/components/ui/uai/step-indicator": StepIndicator,
	"@/components/ui/uai/task-list": TaskList,
	"@/components/ui/uai/testimonial-card": TestimonialCard,
	"@/components/ui/uai/thinking": Thinking,
	"@/components/ui/uai/tool-call": ToolCall,
	"@/components/ui/uai/trust-panel": TrustPanel,
	/** Used by the code `compileSource` appends; not for screens */
	"rabisco:refresh": refresh,
};

export type ExternalSpecifier = keyof typeof externals;

export const isExternalSpecifier = (specifier: string): specifier is ExternalSpecifier =>
	Object.hasOwn(externals, specifier);
