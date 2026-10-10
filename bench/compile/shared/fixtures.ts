export const SMALL = `import { Button } from "@/components/ui/button";

type Props = { title: string };

export default function Welcome({ title = "Calm Habit" }: Props) {
  return (
    <main className="flex h-full flex-col bg-white px-7 pt-18 pb-10 text-slate-900">
      <div className="size-14 rounded-2xl bg-pink-600" />
      <h1 className="mt-auto text-4xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 mb-8 text-base/relaxed text-slate-500">Build gentle habits that stick.</p>
      <Button className="h-12 w-full rounded-xl">Get started</Button>
      <Button variant="ghost" className="mt-2 h-12 w-full rounded-xl">I already have an account</Button>
    </main>
  );
}
`;

export const MEDIUM = `import { useMemo, useState } from "react";
import { Bell, Check, ChevronRight, Flame, Plus, Settings } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Habit = {
  id: string;
  name: string;
  streak: number;
  done: boolean;
  color: "pink" | "violet" | "emerald" | "amber";
  schedule: string;
};

type Filter = "all" | "today" | "done";

const HABITS: Habit[] = [
  { id: "1", name: "Morning walk", streak: 12, done: true, color: "emerald", schedule: "Every day" },
  { id: "2", name: "Read 20 pages", streak: 5, done: false, color: "violet", schedule: "Weekdays" },
  { id: "3", name: "Drink water", streak: 31, done: true, color: "pink", schedule: "Every day" },
  { id: "4", name: "Meditate", streak: 2, done: false, color: "amber", schedule: "Mornings" },
  { id: "5", name: "Journal", streak: 8, done: false, color: "violet", schedule: "Evenings" },
];

const COLOR: Record<Habit["color"], string> = {
  pink: "bg-pink-100 text-pink-700 ring-pink-200",
  violet: "bg-violet-100 text-violet-700 ring-violet-200",
  emerald: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-100 text-amber-700 ring-amber-200",
};

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="gap-1 rounded-2xl border-slate-200/70 p-4 shadow-none">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-emerald-600">{hint}</p> : null}
    </Card>
  );
}

function HabitRow({ habit, onToggle }: { habit: Habit; onToggle: (id: string) => void }) {
  return (
    <li className="group flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-slate-50">
      <span className={cn("grid size-10 place-items-center rounded-xl ring-1 ring-inset", COLOR[habit.color])}>
        <Flame className="size-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[15px] font-medium", habit.done && "text-slate-400 line-through")}>{habit.name}</p>
        <p className="text-xs text-slate-500">{habit.schedule} · {habit.streak} day streak</p>
      </div>
      <button
        type="button"
        onClick={() => onToggle(habit.id)}
        aria-pressed={habit.done}
        className={cn(
          "grid size-8 place-items-center rounded-full border transition-[background-color,transform] active:scale-95",
          habit.done ? "border-transparent bg-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-slate-400",
        )}
      >
        <Check className="size-4" strokeWidth={3} />
      </button>
    </li>
  );
}

export default function Home() {
  const [habits, setHabits] = useState(HABITS);
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(() => {
    if (filter === "done") return habits.filter((h) => h.done);
    if (filter === "today") return habits.filter((h) => h.schedule === "Every day");
    return habits;
  }, [habits, filter]);

  const completion = Math.round((habits.filter((h) => h.done).length / habits.length) * 100);
  const toggle = (id: string) => setHabits((all) => all.map((h) => (h.id === id ? { ...h, done: !h.done } : h)));

  return (
    <div className="flex h-full flex-col bg-white text-slate-900">
      <header className="flex items-center justify-between px-5 pt-14 pb-2">
        <div className="flex items-center gap-3">
          <Avatar className="size-10">
            <AvatarFallback className="bg-pink-100 text-pink-700">MA</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-xs text-slate-500">Good morning</p>
            <p className="text-lg font-semibold tracking-tight">Maria</p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="rounded-full"><Bell className="size-5" /></Button>
          <Button variant="ghost" size="icon" className="rounded-full"><Settings className="size-5" /></Button>
        </div>
      </header>

      <section className="px-5 pt-4">
        <Card className="rounded-3xl border-0 bg-gradient-to-br from-pink-600 to-rose-500 p-5 text-white shadow-lg shadow-pink-600/20">
          <CardHeader className="p-0">
            <CardTitle className="text-sm font-medium text-white/80">This week</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <p className="text-4xl font-bold tabular-nums">{completion}%</p>
            <Progress value={completion} className="mt-4 h-2 bg-white/25 [&>div]:bg-white" />
            <div className="mt-4 flex items-center justify-between text-sm text-white/80">
              <span>{habits.filter((h) => h.done).length} of {habits.length} done</span>
              <Badge className="rounded-full bg-white/20 text-white hover:bg-white/30">+12% vs last week</Badge>
            </div>
          </CardContent>
        </Card>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <StatCard label="Best" value="31d" hint="Drink water" />
          <StatCard label="Active" value={String(habits.length)} />
          <StatCard label="Today" value={habits.filter((h) => h.done).length + "/" + habits.length} />
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col px-2 pt-6">
        <div className="flex items-center justify-between px-3">
          <h2 className="text-base font-semibold">Your habits</h2>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList className="h-8 rounded-full bg-slate-100 p-0.5">
              <TabsTrigger value="all" className="rounded-full px-3 text-xs">All</TabsTrigger>
              <TabsTrigger value="today" className="rounded-full px-3 text-xs">Daily</TabsTrigger>
              <TabsTrigger value="done" className="rounded-full px-3 text-xs">Done</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <ul className="mt-2 flex flex-col overflow-y-auto pb-28">
          {visible.map((habit) => (
            <HabitRow key={habit.id} habit={habit} onToggle={toggle} />
          ))}
        </ul>
      </section>

      <nav className="absolute inset-x-0 bottom-0 flex h-20 items-center justify-around border-t border-slate-100 bg-white/90 backdrop-blur">
        {["Today", "Stats", "Journal", "Profile"].map((item, index) => (
          <button key={item} className={cn("flex flex-col items-center gap-1 text-[11px]", index === 0 ? "text-pink-600" : "text-slate-400")}>
            <span className={cn("size-6 rounded-lg", index === 0 ? "bg-pink-600" : "bg-slate-200")} />
            {item}
          </button>
        ))}
      </nav>
      <Button size="icon" className="absolute right-5 bottom-24 size-14 rounded-full bg-slate-900 shadow-xl">
        <Plus className="size-6" />
        <ChevronRight className="sr-only" />
      </Button>
    </div>
  );
}
`;

/** ~5× MEDIUM; component names are made unique per copy. */
export const LARGE = (() => {
	const body = MEDIUM.split("\n")
		.filter((line) => !line.startsWith("import "))
		.join("\n");

	const imports = MEDIUM.split("\n")
		.filter((line) => line.startsWith("import "))
		.join("\n");

	const copies = Array.from({ length: 5 }, (_, i) =>
		body
			.replaceAll("export default function Home", "function Section" + i)
			.replace(/\b(HABITS|COLOR|StatCard|HabitRow|Habit|Filter)\b/g, "$1_" + i),
	);

	return (
		imports +
		"\n" +
		copies.join("\n") +
		'\nexport default function Dashboard() {\n  return (<div className="grid grid-cols-5 gap-6 p-8">' +
		copies.map((_, i) => "<Section" + i + " />").join("") +
		"</div>);\n}\n"
	);
})();

export const LOCAL_COMPONENTS = {
	"/project/components/stat-card.tsx": `import { Card } from "@/components/ui/card";
export function StatCard({ label, value }: { label: string; value: string }) {
  return <Card className="gap-1 rounded-2xl p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-semibold">{value}</p></Card>;
}
`,
	"/project/components/habit-row.tsx": `import { Check } from "lucide-react";
export function HabitRow({ name, done }: { name: string; done: boolean }) {
  return <li className="flex items-center gap-3 rounded-2xl px-3 py-3"><span className="flex-1">{name}</span>{done ? <Check className="size-4" /> : null}</li>;
}
`,
	"/project/components/bottom-nav.tsx": `export function BottomNav({ items }: { items: string[] }) {
  return <nav className="absolute inset-x-0 bottom-0 flex h-20 items-center justify-around border-t">{items.map((i) => <button key={i}>{i}</button>)}</nav>;
}
`,
};

export const SCREEN_WITH_LOCAL_COMPONENTS = `import { StatCard } from "../components/stat-card";
import { HabitRow } from "../components/habit-row";
import { BottomNav } from "../components/bottom-nav";

export default function Home() {
  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-3 gap-3"><StatCard label="Best" value="31d" /><StatCard label="Active" value="5" /></div>
      <ul>{["Walk", "Read"].map((n) => <HabitRow key={n} name={n} done={n === "Walk"} />)}</ul>
      <BottomNav items={["Today", "Stats"]} />
    </div>
  );
}
`;

export const FIXTURES = { small: SMALL, medium: MEDIUM, large: LARGE } as const;

export type FixtureName = keyof typeof FIXTURES;
