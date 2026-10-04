# Rabisco

An AI-first design canvas: describe an app, get editable screens on an infinite canvas.
Built with [Electrobun](https://framework.blackboard.sh/electrobun/) 2.x (Hutch + Cottontail), React 19, Tailwind v4, shadcn/ui and the [uai](https://uaiblocks.vercel.app) theme and blocks.

## Getting started

```bash
curl -fsSL https://hutch.blackboard.sh/hutch/install.sh | sh   # once
hutch run install     # dependencies (delegated to Bun, see hutch.config.ts)
hutch run dev         # build the UI and launch the app, rebuilding on changes
hutch run dev:hmr     # same, but with the Vite dev server and hot reload
```

Other tasks: `hutch run typecheck`, `hutch run build` (stable), `hutch run build:canary`.

The UI also runs in a plain browser: `hutch run hmr`, then open http://localhost:5173. Outside Electrobun the RPC layer falls back to localStorage.

## Layout

```
src/
  bun/                  main process (Cottontail)
    index.ts            window and RPC handlers
    store.ts            projects as JSON in the userData dir
    ai/generate.ts      prompt → screens (mock today, plug a model in here)
  shared/               types, RPC schema and the mock generator, used by both sides
  mainview/             webview (React)
    lib/rpc.ts          typed RPC client and browser fallback
    views/home.tsx      prompt hero and recent projects
    views/editor/       chat panel, infinite canvas, inspector
    components/ui/      shadcn primitives, uai blocks in ui/uai
```

## UI kit

Add shadcn primitives with `bunx --bun shadcn@latest add <name>`, and uai blocks with
`bunx --bun shadcn@latest add @uai/<name>` (the registry is configured in `components.json`).
The CLI sometimes writes `from "cn"` instead of `@/lib/utils`; fix the import if it does.

## Canvas shortcuts

| Key | Action |
| --- | --- |
| `V` / `H` | Move / hand tool |
| `Space` + drag | Pan |
| Scroll / ⌘ + scroll | Pan / zoom |
| `⇧1` | Zoom to fit |
| `⌘0`, `⌘+`, `⌘-` | Reset zoom, zoom in, zoom out |
| `⌘D`, `⌫` | Duplicate, delete the selected screen |
