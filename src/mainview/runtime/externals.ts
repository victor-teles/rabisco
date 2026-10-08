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
import * as Popover from "@/components/ui/popover";
import * as Progress from "@/components/ui/progress";
import * as ScrollArea from "@/components/ui/scroll-area";
import * as Separator from "@/components/ui/separator";
import * as Tabs from "@/components/ui/tabs";
import * as Textarea from "@/components/ui/textarea";
import * as Toggle from "@/components/ui/toggle";
import * as ToggleGroup from "@/components/ui/toggle-group";
import * as Tooltip from "@/components/ui/tooltip";
import { frameAssets } from "./assets";
import { lucide } from "./icons";
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
	"@/components/ui/popover": Popover,
	"@/components/ui/progress": Progress,
	"@/components/ui/scroll-area": ScrollArea,
	"@/components/ui/separator": Separator,
	"@/components/ui/tabs": Tabs,
	"@/components/ui/textarea": Textarea,
	"@/components/ui/toggle": Toggle,
	"@/components/ui/toggle-group": ToggleGroup,
	"@/components/ui/tooltip": Tooltip,
	/** Used by the code `compileSource` appends; not for screens */
	"rabisco:refresh": refresh,
};

export type ExternalSpecifier = keyof typeof externals;

export const isExternalSpecifier = (specifier: string): specifier is ExternalSpecifier =>
	Object.hasOwn(externals, specifier);
