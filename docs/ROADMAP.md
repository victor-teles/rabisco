# Rabisco roadmap

This roadmap orders the work by dependency. Each phase delivers something usable on its own. The [principles](./PRINCIPLES.md) explain why it is built this way.

Status: ✅ done · 🚧 in progress · ⬜ not started

---

## Phase 0: Foundation ✅

The shell of the app, with a mock generator.

- ✅ Electrobun 2 app (Hutch, Cottontail) with React 19, Tailwind v4, shadcn/ui and the uai theme
- ✅ Typed RPC between the main process and the webview, with a localStorage fallback for the browser
- ✅ Home: prompt, device and model pickers, recent projects
- ✅ Editor: chat panel, infinite canvas (pan, zoom, drag, fit), inspector, screen list
- ✅ Projects saved as JSON in the userData directory
- ✅ Mock generator that returns HTML screens (`src/shared/mock-generator.ts`)

---

## Phase 1: React screens and project files 🚧

*Principles: Screens are React · Context is a file · UX first*

Replace HTML strings with TSX components, and store each project as a folder of readable files.

**Project format**

- ✅ A project is a folder, not one JSON blob:
  ```
  my-app.rabisco/
    rabisco.json        # canvas layout: frame positions, sizes, selection, alternates
    PRODUCT.md
    DESIGN.md
    screens/welcome.tsx
    components/button.tsx
    chat.jsonl          # conversation history
  ```
- ✅ Open any folder as a project, and keep a list of recent folders on Home
- ✅ Watch the folder so that edits made in an external editor appear on the canvas
- ✅ Migrate existing JSON projects

**Rendering** ([0001](./decisions/0001-compile-tsx-in-the-webview.md), [0002](./decisions/0002-incremental-tailwind-in-the-host.md))

- ✅ Benchmark where to compile TSX and build CSS ([bench/compile](../bench/compile))
- ✅ Screen runtime: a prebuilt bundle containing React and the shadcn components, loaded in a sandboxed iframe (`allow-scripts` only, no same-origin access)
- ✅ The main process pushes file source to the webview. The webview compiles each file with Sucrase, cached by content hash
- ✅ A module registry in each frame resolves `react`, `@/components/ui/*` and project components, so only frames that import a changed file re-render
- ✅ One Tailwind `compile()` per project in the host. `build()` runs only when new classes appear, and the CSS is shared with all frames
- ✅ Render errors appear inside the frame with the error line, and never break the canvas
- 🚧 Investigate the ~17.5 ms RPC round-trip floor: cause found ([0005](./decisions/0005-rpc-round-trip-floor.md)), confirmation in the running app pending
- ✅ Mock generator outputs TSX that uses shadcn components

**UX basics**

- ✅ Undo and redo for every canvas and AI change (⌘Z / ⇧⌘Z)
- ✅ Multi-select, marquee selection, align and distribute
- ✅ Code view for the selected screen (read-only at first)

**Remaining:** check in the running app (WKWebView) that a generated screen is written to disk and renders, and that an edit made in VS Code updates the canvas.

**Done when** a generated screen is a `.tsx` file on disk that renders on the canvas, and editing that file in VS Code updates the canvas.

---

## Phase 2: AI providers ⬜

*Principle: Bring your own AI*

**Provider layer** (`src/bun/ai/providers/`)

- ✅ Contract: providers write files, delivered as one event stream ([0003](./decisions/0003-ai-provider-contract.md), [`contract.ts`](../src/shared/ai/contract.ts))
- ⬜ Text protocol parser for API providers (`<rabisco-file>` tags → file events)
- ⬜ Staging-directory runner for CLI and SDK agents (watch, then diff against the project)
- ⬜ Validation pipeline (path, compile, imports, exports, render) and the automatic repair loop (2 attempts)
- ⬜ Health check and model list for each provider

**Providers**

- ⬜ **API:** Anthropic (first), OpenAI, OpenRouter, Ollama, and any OpenAI-compatible endpoint
- ⬜ **CLI:** Claude Code (`claude -p --output-format stream-json`), then Codex CLI and Gemini CLI, run as subprocesses inside the project folder
- ⬜ **SDK:** Claude Agent SDK, so that the agent can read and write project files with tools

**Settings and UX**

- ⬜ Settings screen: add a provider, test the connection, choose the default model
- ⬜ Credentials kept in the OS keychain, never in project files
- ⬜ Generation streams into the frame as code arrives, and you can stop it at any point
- ⬜ Clear, actionable errors (missing CLI, invalid key, rate limit) with a fix button
- ⬜ Remove the mock generator from production builds

**Done when** the same prompt works with an API key, with the Claude Code CLI and with a local Ollama model, and nothing outside the provider layer changes.

---

## Phase 3: PRODUCT.md and DESIGN.md ⬜

*Principle: Context is a file*

- ⬜ Read both files from the project folder, and include them in every generation prompt
- ⬜ Context panel in the editor: view and edit both files, and see which one shaped the last result
- ⬜ Templates for both files when a project starts
- ⬜ "Write my DESIGN.md": infer the tokens and rules from the existing screens
- ⬜ "Write my PRODUCT.md": a short interview in the chat
- ⬜ Map DESIGN.md tokens to Tailwind theme variables, so that a token change re-themes every screen
- ⬜ Import the files from an existing repository

**Done when** changing the primary color or the voice in the files changes the next generation, with no extra prompt.

---

## Phase 4: Variations ⬜

*Principle: Variations, not verdicts*

- ⬜ Choose how many variations to generate (1–4) in the composer
- ⬜ Variations run as N parallel generations of the same task, and Rabisco names the files `*.alt-N.tsx` ([0004](./decisions/0004-alternates-are-files.md))
- ⬜ Variations appear as a group on the canvas
- ⬜ Compare mode: variations side by side at the same zoom level, with a synced scroll
- ⬜ Pick one. Picking swaps file contents, so `welcome.tsx` is always the chosen version and imports keep working
- ⬜ "Vary this": new variations from a selected screen, with an optional direction ("bolder", "denser")
- ⬜ Mix: take a section from one variation into another

**Done when** a user can generate 3 versions of a screen, compare them, keep one and come back to the others later.

---

## Phase 5: Components and design system ⬜

*Principle: Component based by default*

- ⬜ Components panel: project components plus the shadcn library, searchable, with previews
- ⬜ Drag a component onto a screen
- ⬜ "Make component": extract the selected structure to `components/*.tsx`, and replace it everywhere it repeats
- ⬜ Edit a component once, and every screen updates
- ⬜ Props and variants appear as controls in the inspector
- ⬜ The generator reuses project components first, and creates new ones only when needed
- ⬜ Rabisco suggests a component when it finds duplicate structure

**Done when** changing a button component updates it on every screen, and new generations use that component.

---

## Phase 6: Direct editing ⬜

*Principle: UX first (direct manipulation over prompts)*

- ⬜ Select an element inside a screen (source-mapped to its TSX node)
- ⬜ Edit text inline
- ⬜ Inspector for the selected element: spacing, color, type and layout, written back to the Tailwind classes
- ⬜ Point and prompt: select an element and ask for a change to that element only
- ⬜ Comments and pins on the canvas
- ⬜ Prototype links between screens, plus a play mode

**Done when** most small changes need no prompt.

---

## Phase 7: Export and handoff ⬜

*Principle: Screens are React (what you see is what you ship)*

- ⬜ Copy a screen or a component as code
- ⬜ Export a runnable Vite + React + Tailwind project (screens, components, theme)
- ⬜ Export images (PNG, SVG) and a PDF of the flow
- ⬜ Share a read-only link
- ⬜ Sync to a git repository

---

## Later

- Real-time collaboration
- Import from Figma, from a screenshot or from a live URL
- Responsive breakpoints for each screen
- Plugin API for custom providers and exporters
- App icon, code signing, auto-updates and release channels

## Decisions

The open questions from the first draft are settled. See [docs/decisions](./decisions):

- **Where to compile TSX:** in the webview, with Sucrase. The RPC round trip (~17.5 ms) costs far more than compiling (~0.3 ms) ([0001](./decisions/0001-compile-tsx-in-the-webview.md)).
- **Tailwind in the sandbox:** one incremental compiler in the host, with the CSS shared by all frames. It rebuilds only when new classes appear ([0002](./decisions/0002-incremental-tailwind-in-the-host.md)).
- **Agent or one-shot generation:** both. Every provider writes files through one event contract ([0003](./decisions/0003-ai-provider-contract.md)).
- **Alternates storage:** files, `screens/<name>.alt-N.tsx` ([0004](./decisions/0004-alternates-are-files.md)).
