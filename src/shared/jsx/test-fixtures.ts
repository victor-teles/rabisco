/** Realistic generated files for the JSX tests (imported by tests only). */

import { transform } from "sucrase";

export const DASHBOARD = `import { useState } from "react";
import { ArrowUpRight, Bell, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TabBar } from "../components/tab-bar";

// Rows render when count < 10 and the filter is "a > b"
const ORDERS = [
	{ id: "o-1", name: "Oat latte", price: "$4.50" },
	{ id: "o-2", name: "Croissant", price: "$3.20" },
];

function Header({ title }: { title: string }) {
	const [query, setQuery] = useState<string>("");
	const pick = <T,>(items: T[]) => items[0];
	return (
		<header className="flex items-center justify-between px-5 pt-12">
			<h1 className="text-xl font-semibold">{title}</h1>
			<Button variant="ghost" size="icon" aria-label="Notifications" onClick={() => setQuery(pick([query]) ?? "")}>
				<Bell className="size-5" />
			</Button>
		</header>
	);
}

export default function Dashboard() {
	const [open, setOpen] = useState(false);
	const hint = "Use { and > freely";
	return (
		<div className="flex h-full flex-col bg-background">
			<Header title="Today" />
			<div className="grid grid-cols-2 gap-3 px-5">
				<Card className="gap-1 py-4">
					<CardContent className="px-4">
						<p className="text-sm text-muted-foreground">Revenue</p>
						<p className="text-2xl font-semibold">$12,480</p>
					</CardContent>
				</Card>
				<Card className="gap-1 py-4">
					<CardContent className="px-4">
						<p className="text-sm text-muted-foreground">Orders</p>
						<p className="text-2xl font-semibold">318</p>
					</CardContent>
				</Card>
			</div>
			<ul className="divide-y px-5">
				{ORDERS.map((order) => (
					<li key={order.id} className="flex items-center justify-between py-3">
						<span className="font-medium">{order.name}</span>
						<span className="text-muted-foreground">{order.price}</span>
					</li>
				))}
			</ul>
			{open && <p className="px-5 text-sm">{hint}</p>}
			<div className="relative px-5">
				<Search className="absolute left-8 top-2.5 size-4" />
				<input className={cn("h-9 w-full rounded-md border pl-9", open && "ring-2")} placeholder="Search orders" />
			</div>
			<a href="/reports" className="flex items-center gap-1 px-5 text-sm" onClick={() => setOpen(!open)}>
				View reports <ArrowUpRight className="size-4" />
			</a>
			<TabBar active={0} />
		</div>
	);
}
`;

export const ANALYTICS = `import { Card, CardContent } from "@/components/ui/card";

export default function Analytics() {
	return (
		<main className="space-y-4 p-5">
			<Card className="gap-1 py-4">
				<CardContent className="px-4">
					<p className="text-sm text-muted-foreground">Visitors</p>
					<p className="text-2xl font-semibold">8,210</p>
				</CardContent>
			</Card>
			<Card className="gap-1 py-6">
				<CardContent className="px-4">
					<p className="text-sm text-muted-foreground">Different padding</p>
					<p className="text-2xl font-semibold">1</p>
				</CardContent>
			</Card>
		</main>
	);
}
`;

export const TAB_BAR = `import { House } from "lucide-react";

export function TabBar({ active = 0 }: { active?: number }) {
	return (
		<nav className="flex h-20 items-start justify-around border-t">
			<div className={active === 0 ? "text-foreground" : "text-muted-foreground"}>
				<House className="size-5" />
				Home
			</div>
		</nav>
	);
}
`;

/** Compiles like the renderer does; throws on a syntax error. */
export function compiles(source: string) {
	transform(source, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true });

	return true;
}
