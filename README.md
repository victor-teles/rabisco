# Rabisco

An AI-first design canvas: describe an app, get editable screens on an infinite canvas.
Built with [Electrobun](https://framework.blackboard.sh/electrobun/) 2.x (Hutch + Cottontail), React 19, Tailwind v4, shadcn/ui and the [uai](https://uaiblocks.vercel.app) theme and blocks.

See [docs/PRINCIPLES.md](docs/PRINCIPLES.md) for how Rabisco makes decisions and [docs/ROADMAP.md](docs/ROADMAP.md) for what comes next.

## Getting started

```bash
curl -fsSL https://hutch.blackboard.sh/hutch/install.sh | sh   # once
hutch run install     # dependencies (delegated to Bun, see hutch.config.ts)
hutch run dev         # build the UI and launch the app, rebuilding on changes
hutch run dev:hmr     # same, but with the Vite dev server and hot reload
```

Other tasks: `hutch run typecheck`, `hutch run lint` (oxlint with the vendored [anti-slop](tools/oxlint/anti-slop/UPSTREAM.md) rules), `hutch run fmt` (oxfmt), `hutch run build` (stable), `hutch run build:canary`, `hutch run bench:gen` (the generation eval, see [bench/gen](bench/gen/README.md)).

The UI also runs in a plain browser: `hutch run hmr`, then open http://localhost:5173. Outside Electrobun the RPC layer falls back to localStorage.

## Layout

```
src/
  bun/                  main process (Cottontail)
    index.ts            window and RPC handlers
    store.ts            project folders, recents and file watching
    ai/                 provider layer (decision 0003): settings, keychain, validation, repair loop
      providers/        Anthropic, OpenAI-compatible, Claude Code, Codex, Gemini CLI, Claude Agent SDK
  shared/               types, RPC schema, the AI contract and the dev-only mock generator
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

| Key                                                     | Action                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `V` / `H` / `C`                                         | Move / hand / comment tool                                                   |
| `Space` + drag                                          | Pan                                                                          |
| Scroll / ⌘ + scroll                                     | Pan / zoom                                                                   |
| `⇧1`                                                    | Zoom to fit                                                                  |
| `⌘0`, `⌘+`, `⌘-`                                        | Reset zoom, zoom in, zoom out                                                |
| `⌘D`, `⌫`                                               | Duplicate, delete the selected screen                                        |
| `⌘R`                                                    | Rename the selected screen                                                   |
| `⌥N`                                                    | New blank screen (presets in the toolbar and the canvas menu)                |
| Double-click a screen's label                           | Rename it in place                                                           |
| Drag a selected screen's edge or corner                 | Resize the screen (`⇧` keeps the ratio, `⌥` from the center)                 |
| `⌥1`                                                    | Screens list, or back to the chat                                            |
| `⌥↑` / `⌥↓` (Screens list)                              | Move the focused screen up / down                                            |
| `⇧⌘\`                                                   | Show or hide the chat and screens panel                                      |
| `⇧⌘O`                                                   | New chat                                                                     |
| `/` in the chat                                         | Chat commands: Rabisco's own and your CLI's commands                         |
| `⌘I` in a prompt (Home or chat)                         | Improve prompt: expand it into a brief to edit; `⌘Z` puts the original back  |
| `↵` / `Esc` (plan card focused)                         | Generate the plan's screens / cancel the plan                                |
| Double-click the title bar                              | Zoom the window (follows the macOS setting)                                  |
| `⌥C`                                                    | Comments list                                                                |
| `⌘C`, `⌘V`                                              | Copy the selected screens, paste screens or screen code as new screens       |
| Right-click a screen, element or the canvas             | Every action for what's under the pointer, with its shortcut                 |
| `⌘K`                                                    | Command palette: every action, searchable                                    |
| `?`                                                     | Keyboard shortcuts                                                           |
| Click inside the selected screen, or `⌘`-click          | Select the element under the pointer (hover shows its name and size)         |
| `⇧`-click (element selected), `⇧`/`⌘`-click (Layers)    | Add or remove an element from the selection; style edits apply to all        |
| Double-click, or `Enter` on an element without children | Edit its text in place (`Enter` keeps it, `Esc` cancels)                     |
| `Enter` / `⇧↵` or `Esc`                                 | Select the first child / the parent (`Esc` first goes back to one element)   |
| `⇥` / `⇧⇥`                                              | Select the next / previous sibling                                           |
| `↑` `←` / `↓` `→` (element selected)                    | Move it earlier / later among its siblings                                   |
| Drag an element in the selected screen                  | Move it within its parent or into another container                          |
| Drag an item of a list (`.map`) in the selected screen  | Reorder it among the list's items                                            |
| Drag an edge or corner handle                           | Resize (`w-*`/`h-*`, snapped); double-click a handle to hug                  |
| Drag a padding or gap bar                               | Change padding or gap (`⌥` all sides, `⇧` both opposite sides)               |
| `⌫` (element selected)                                  | Delete it                                                                    |
| `⌘D`, `⌘C`, `⌘X`, `⌘V` (element selected)               | Duplicate, copy, cut, paste after it (between screens too)                   |
| `⌥⌘G`, `⇧A`, `⇧⌘G` (element selected)                   | Wrap in a div, wrap in a flex stack, unwrap                                  |
| Prompt with an element selected                         | Change only that element (point and prompt)                                  |
| `⌥2`                                                    | Components panel: project components, the shadcn library and suggestions     |
| `/` or `⌘F` (Components panel open)                     | Search components                                                            |
| Drag from the Components panel                          | Add the component to the screen under the pointer                            |
| `⇧D`                                                    | Code tab: the selected screen's or component's structure and editable source |
| `↑` `↓` / `←` `→` (Structure)                           | Move through elements / collapse, expand                                     |
| `⌥⌘K` or `Enter` (Structure)                            | Make component from the selected element, and replace its repeats            |
| `⌫` (Structure)                                         | Delete the selected element                                                  |
