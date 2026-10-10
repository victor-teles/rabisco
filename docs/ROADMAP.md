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

_Principles: Screens are React · Context is a file · UX first_

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
    chats/<id>.jsonl    # one file per chat session (decision 0012)
    attachments/        # images attached to prompts, referenced from the chats
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

## Phase 2: AI providers 🚧

_Principle: Bring your own AI_

**Provider layer** (`src/bun/ai/`)

- ✅ Contract: providers write files, delivered as one event stream ([0003](./decisions/0003-ai-provider-contract.md), [`contract.ts`](../src/shared/ai/contract.ts))
- ✅ Text protocol parser for API providers (`<rabisco-file>` tags → file events, `protocol.ts`), and the prompts (`prompt.ts`)
- ✅ Staging-directory runner for CLI and SDK agents: watch, then diff against the request (`staging.ts`)
- ✅ Validation pipeline (path, compile, imports, exports in `validate.ts`; render in the frames) and the automatic repair loop (2 attempts, `run.ts`)
- ✅ Health check and model list for each provider (`providers/index.ts`)

**Providers**

- ✅ **API:** Anthropic, OpenAI, OpenRouter, Ollama, and any OpenAI-compatible endpoint
- ✅ **CLI:** Claude Code (`claude -p --output-format stream-json`), Codex CLI (`codex exec --json`) and Gemini CLI, run as subprocesses in a staging copy of the project
- ✅ **SDK:** Claude Agent SDK, so that the agent can read and write project files with tools

**Settings and UX**

- ✅ Settings screen: add a provider, test the connection, choose the default model
- ✅ Credentials kept in the OS keychain (macOS `security`, Linux `secret-tool`), never in project files
- ✅ Generation streams into the frame as code arrives, and you can stop it at any point
- ✅ Clear, actionable errors (missing CLI, invalid key, rate limit) with a fix button
- ✅ Remove the mock generator from production builds (dev channel and the browser fallback only)

**Remaining:** run real generations in the app with an API key, with Claude Code and with Ollama. Gemini CLI is built from its docs, and the Codex event mapping is untested against a real run. The Claude Agent SDK needs its native binary embedded in the app bundle (`pathToClaudeCodeExecutable`).

**Done when** the same prompt works with an API key, with the Claude Code CLI and with a local Ollama model, and nothing outside the provider layer changes.

---

## Phase 3: PRODUCT.md and DESIGN.md 🚧

_Principle: Context is a file_

- ✅ Read both files from the project folder, and include them in every generation prompt, repairs included. An untouched template (headings and `<!-- -->` guidance only) counts as no context (`src/shared/context/body.ts`)
- ✅ Context panel in the editor (Context tab, ⇧C): view and edit both files with undo, token swatches and invalid token lines for DESIGN.md, and "Followed DESIGN.md · PRODUCT.md" under each reply
- ✅ Templates for both files when a project starts (`src/shared/context/templates.ts`)
- ✅ "Write my DESIGN.md": a `context` generation task infers the tokens and rules from the existing screens
- ✅ "Write my PRODUCT.md": a four-question interview in the chat, then a `context` generation (or the answers assembled directly when no provider is set)
- ✅ Map DESIGN.md tokens to the theme variables. Frames get the overrides as a second stylesheet, so new tokens re-theme every screen with no Tailwind rebuild (`src/shared/context/tokens.ts`). An optional `## Tokens` section (`- primary: oklch(…)`, `### Dark`) is used as it is, with no AI
- ✅ Any DESIGN.md format themes the screens ([0009](./decisions/0009-theme-read-from-design-md.md)). Without valid tokens in a Tokens section, a `theme` generation task reads them from the whole file (prose, tables, `{colors.primary}` references) and maps them onto the shadcn names. It replies with a token block, checked with `validateToken`, and never writes DESIGN.md (`src/shared/context/theme.ts`, `runThemeReading`)
- ✅ Ask before re-theming. Screens render with the applied theme, stored as `theme` in `rabisco.json` with the `source` (a hash of DESIGN.md's content) it came from. When DESIGN.md's tokens differ, the bar over the canvas offers "Apply to screens". When DESIGN.md changed and has no tokens, it offers "Update theme" (progress and Stop in the bar, or "Open Settings" with no provider), then shows the changed colors with Undo. Each is one undo step; "Not now" waits for the next change. Readings are cached by source. Exports and the share link use the applied theme. A project without `theme` takes DESIGN.md's tokens as applied
- ✅ Import the files from an existing repository (root, `docs/`, `design/`, `.github/`…)

**Remaining:** in the running app, check import from a repository (folder picker, replace dialog), the `context` and `theme` tasks with real providers (API, Claude Code, Ollama), and that applying new tokens re-themes open frames in WKWebView.

**Done when** changing the primary color or the voice in the files changes the next generation, with no extra prompt.

---

## Phase 4: Variations 🚧

_Principle: Variations, not verdicts_

- ✅ Choose how many variations to generate (1–4) in the composer, on Home and in the chat. The choice is remembered. With screens selected, prompts edit them and the count is ignored
- ✅ Variations run as N parallel generations of the same task, and Rabisco names the files `*.alt-N.tsx` as they stream in ([0004](./decisions/0004-alternates-are-files.md), `src/shared/ai/variants.ts`). Components a variation writes get a `-vN` name unless they match the primary's
- ✅ Variations appear as a group on the canvas: one row per variation, a dashed outline with a "Compare" chip, "Picked" and "Pick" on the frame labels
- ✅ Compare mode (⇧V or the chip): variations side by side at the same zoom, with a synced scroll. Frames report their content height, so every column scrolls in one container
- ✅ Pick one. Picking swaps file contents, so `welcome.tsx` is always the chosen version and imports keep working. It is one undo step
- ✅ "Vary this" (inspector): new variations from a selected screen, with an optional direction ("bolder", "denser")
- ✅ Mix (inspector): take a section from one variation into another, as an edit that reads the source variation without changing it

**Remaining:** run variations with real providers (API, Claude Code, Ollama) in the running app, including parallel CLI runs and rate limits. Mix was tested in unit tests only.

**Done when** a user can generate 3 versions of a screen, compare them, keep one and come back to the others later.

---

## Phase 5: Components and design system 🚧

_Principle: Component based by default_ ([0006](./decisions/0006-components-from-source.md))

- ✅ Components panel (Components tab, ⌥2): project components plus the shadcn library (`src/shared/components/library.ts`), searchable, with live previews and a variant grid. Previews render lazily in sandboxed frames
- ✅ Drag a component onto a screen: the frame hit-tests the drop point (`data-rabisco-loc`), and Rabisco inserts the component into the nearest container element, with its import, as one undo step
- ✅ "Make component" (⌥⌘K, from the Structure outline in the Code tab): extract the selected structure to `components/*.tsx`, and replace it everywhere it repeats. Text and string attributes that differ become props (`src/shared/jsx/extract.ts`)
- ✅ Edit a component once, and every screen updates: select it in the Components tab, then edit it with a prompt or in the code view (now editable). Frames re-render when any module they import changes
- ✅ Props and variants appear as controls in the inspector, for project components and shadcn components (`prop-controls.tsx`)
- ✅ The generator reuses project components first: every request carries a catalog of component signatures, and validation rejects a new component that re-exports an existing name
- ✅ Rabisco suggests a component when it finds duplicate structure (Suggestions in the Components tab). You can make it a component or dismiss it

**Remaining:** check in the running app (WKWebView) that drag and drop from the panel works and that the editable code view behaves well. Also check with real providers that generations reuse project components.

**Done when** changing a button component updates it on every screen, and new generations use that component.

---

## Phase 6: Direct editing 🚧

_Principle: UX first (direct manipulation over prompts)_

- ✅ Select an element inside a screen: click inside the selected screen (or ⌘-click any screen), hover outlines, Esc walks up to the parent. Every element, component usages included, carries `data-rabisco-loc`; the runtime reads it from React's fiber tree, so a `<StatCard>` maps back to its JSX even when it doesn't pass props on (`src/mainview/runtime/inspect.ts`). The selection is the Structure selection in the Code tab
- ✅ Edit text inline: double-click (or Enter) edits the text inside the frame, with the screen's own fonts; Enter keeps it as one undo step, Esc cancels (`runtime/text-edit.ts`)
- ✅ Inspector for the selected element: layout, spacing, size, type, fill, border and effects, read from and written back to its Tailwind classes; only classes without a variant change (`src/shared/tailwind/classes.ts`, `element-style.tsx`)
- ✅ Point and prompt: with an element selected, a prompt changes only that element. The request carries its snippet and lines, and the reply notes changes made outside it (`src/shared/ai/focus.ts`, `src/bun/ai/focus-guard.ts`)
- ✅ Comments and pins on the canvas (C): pinned to a screen or the canvas, threads with replies, resolve, drag to move, undoable, saved in `rabisco.json`. "Send to chat" puts a comment in the composer, targeting the element under its pin. "Send comments to chat" (screen menu, command palette) puts all of a screen's open comments there as one list. Both add to what is already typed, so you can review before sending. When the AI changes the design for a prompt sent from comments, those comments are resolved in the same undo step, with a toast to reopen them. AI providers settings can turn this off. Resolving fades the pin out instead of removing it at once
- ✅ Prototype links between screens, plus a play mode ([0007](./decisions/0007-prototype-links-in-source.md)): "Link to" in the inspector writes `data-link-to` in the TSX, connectors on the canvas, and play mode (⌥⌘↵) runs the screens interactively with back and forward

**Remaining:** check in the running app (WKWebView) that hit tests through the fiber tree, text editing in a frame (focus, caret, Enter/Esc) and play mode clicks behave as in Chrome. Run point and prompt with real providers and see how often the guard fires. Connectors start at the frame edge, not at the linked element.

**Done when** most small changes need no prompt.

---

## Phase 7: Export and handoff 🚧

_Principle: Screens are React (what you see is what you ship)_

- ✅ Copy a screen or a component as code: Export → "Copy code" copies the open component or the first selected screen verbatim. "Copy with components" adds the project files it imports, transitively, each headed by its path (`src/shared/export/code.ts`, `src/mainview/views/editor/export/code-export.ts`)
- ✅ Export a runnable Vite + React + Tailwind project (screens, components, theme): screens and components copied verbatim to `src/screens` and `src/components`, only the shadcn components they use (and their ui imports), the canvas theme with DESIGN.md tokens, `package.json` from the packages the files import, and an `App.tsx` hash router that follows `data-link-to` from the first frame. Alternates are left out (`src/shared/export/vite-project.ts`)
- ✅ Export images (PNG, SVG) and a PDF of the flow: Export → PNG (2x), SVG or "PDF of the flow", for the selected screens or every screen except alternates. Each screen renders in a hidden frame at its full content height, and the runtime reads the DOM into a scene of boxes, text lines, images and SVG paths (`runtime/snapshot.ts`). SVG is real shapes and text in sRGB, readable by design tools; PNG and the PDF's JPEGs are painted from the same scene on a canvas (`runtime/raster.ts`), since WebKit taints a canvas that draws an SVG `<foreignObject>`. The PDF has an overview page, then one page per screen in flow order (prototype links breadth-first from the first screen), with clickable links between pages and bookmarks, written by a small dependency-free PDF writer (`src/shared/export/scene.ts`, `pdf.ts`, `flow.ts`, `export/image-export.ts`)
- ✅ Share a read-only link ([0008](./decisions/0008-share-link-and-git-sync.md)): Share → Link serves a static viewer on the local network (`http://<LAN IP>:<port>/<token>/`) with copy, open, "Update link" and "Stop sharing". The viewer plays the picked screens with the real screen runtime, the same compiled modules, Tailwind CSS and DESIGN.md tokens as the canvas, and follows `data-link-to`. The server is read-only (GET only, a random token, files in memory). "Export as website…" writes the same viewer to a folder that works on any static host and from `file://` (`src/shared/share/viewer.ts`, `src/mainview/lib/share-snapshot.ts`, `src/bun/share.ts`)
- ✅ Sync to a git repository ([0008](./decisions/0008-share-link-and-git-sync.md)): Share → Git shows the branch, remote, changes, ahead/behind and last commit. "Set up git" runs `git init` with a `.gitignore` and a first commit, and you can add or change the remote. "Sync" commits the project folder with a generated message (`Rabisco: add settings screen, update DESIGN.md`), rebases onto the remote and pushes, never forcing. A conflict aborts the rebase and leaves the repository clean. Inside a bigger repository, only the project folder is committed. Pulled files reach the canvas through the folder watcher (`src/bun/git.ts`, `src/shared/git.ts`, `export/git-section.tsx`)

**Remaining (images):** check PNG, SVG and PDF export in the running app (WKWebView). They were checked in Chrome only, with the SVG and PDF also opened in macOS QuickLook and PDFKit. Not drawn: CSS transforms other than translation, filters, masks, inset shadows, `::before`/`::after` content and text-overflow ellipses. External images are embedded only when their server allows CORS, otherwise a gray box is drawn. Web fonts are referenced by name in SVG, not embedded.

**Remaining (share and git):** check in the running app that the Share popover works in WKWebView (clipboard, opening the link) and that the bundle path `views/mainview/runtime` resolves in a packaged build, and open the link from another device (macOS may ask to allow incoming connections). The viewer was tested in Chrome over HTTP and `file://`, not in Safari. Run sync against GitHub over HTTPS and SSH. `rabisco.json` isn't watched: Sync saves the canvas before it commits and reloads it when commits came in, but a `git pull` run outside Rabisco shows the new layout only after the project is reopened.

---

## Phase 8: Finish and verify 🚧

_Principle: UX first (no dead ends)_

Phases 1–7 are built but checked mostly in Chrome and unit tests. This phase collects every "Remaining" item above into one pass, and fixes the bugs the code audit found.

**Bugs**

- ✅ The first prompt is lost when no provider is set up: Home creates the project, the editor marks the prompt as sent, and `ready()` gives up (`editor.tsx`, `use-generation.ts`). Keep the prompt in the composer, and send it once a provider is added
- ✅ Arrow keys with an element selected nudge the whole screen (`editor.tsx` checks `selected`, not `element`)
- ✅ AI actions are silently ignored while a generation runs (comment "Ask AI", chat). Disable them with a reason, or queue them
- ✅ ⌫ deletes the selected screens while focus is on an inspector button (`isTyping` only skips text fields). The canvas Space handler uses its own `isTyping` that misses `<select>`
- ✅ Resolved comments can't be shown again (`setShowResolved` has no UI)
- ✅ Home: "Projects" and the sidebar Settings button do nothing; "New design" with an empty prompt creates a folder right away
- ✅ Images attached to a prompt are sent but not kept in `chat.jsonl`
- ✅ The Tailwind builder is never reset, so classes and CSS grow across every project opened in a session (`styles.ts`)

**Checks in the running app (WKWebView)**

- ✅ A generated screen is written to disk and renders; an edit in VS Code updates the canvas (Phase 1)
- ✅ Confirm the RPC round-trip floor fix ([0005](./decisions/0005-rpc-round-trip-floor.md))
- ✅ Hit tests through the fiber tree, text editing (focus, caret, Enter/Esc), play mode clicks, drag and drop from the Components panel, the editable code view
- 🚧 Context import (folder picker, replace dialog), and applying changed DESIGN.md tokens re-themes open frames. The reported "tokens don't re-theme" case was a DESIGN.md with no `## Tokens` section, so it set no tokens. A Tokens section is no longer needed: "Update theme" reads the theme from any DESIGN.md with AI ([0009](./decisions/0009-theme-read-from-design-md.md)); checked in the browser with the mock provider and a pasted Coinbase-style file. Recheck in the app with a real provider. Paste didn't work in the context editor: WKWebView gets ⌘C/⌘V/⌘Z only through native Edit menu roles, so the app now sets an application menu (`src/bun/index.ts`). Recheck paste
- ⬜ PNG, SVG and PDF export; the Share popover (clipboard, open link); the share link from another device

**Real providers**

- ⬜ The same prompt with an API key, Claude Code and Ollama: screens, `context` tasks, variations (parallel CLI runs, rate limits), Mix, point and prompt (how often the guard fires), component reuse
- ⬜ A real Codex run to check its event mapping; Gemini CLI against its docs
- ✅ Embed the Claude Agent SDK native binary in the app bundle (`pathToClaudeCodeExecutable`)

**Packaging**

- ✅ The runtime bundle path `views/mainview/runtime` resolves in a packaged build (checked in an unpacked canary build, with `app/bin/claude`)
- ⬜ Git sync against GitHub over HTTPS and SSH

**Done when** every phase above can be marked ✅.

---

## Phase 9: Performance and snappy interactions 🚧

_Principle: UX first (fast feedback)_

Today every wheel, pan and drag event re-renders the whole editor, every screen is a live iframe with its own 1.2 MB runtime, and each keystroke writes to disk and remounts the screen. Fix the hot paths first, so the editing work in the next phases starts from a fast base.

**Targets** (measured in the packaged app on a 30-screen project)

- Pan and zoom hold 60 fps, with no React render of the editor per event. WKWebView caps page rendering near 60 Hz by default (WebKit's "Prefer page rendering updates near 60fps"), even on ProMotion displays, and Electrobun doesn't expose the setting. 120 fps needs a native change
- Dragging a frame or a pin holds 60 fps and is one history commit
- A keystroke in the code view or a style field shows in the frame within 50 ms
- Opening a project shows the first frames within 500 ms, with one Tailwind build

**Canvas**

- ✅ Keep the viewport out of React state: write the transform to the DOM in requestAnimationFrame, and update the zoom readout lazily
- ✅ Pass zoom to counter-scaled chrome (labels, outlines, link connectors) as a `--zoom` CSS variable, so frames stay memoized while zooming
- ✅ Draw the dot grid on its own layer; add `will-change: transform` during a gesture; cheaper frame shadows
- ✅ Frame, pin and field drags update a transient layer and commit once on pointerup (`use-project.ts` `change()` runs per pointermove today)
- ✅ Memoize the editor panels (chat, inspector, code view lines) and stabilize inline props (`exportContext`, `overlay`, zoom handlers)

**Frames**

- ✅ Mount only frames in or near the viewport. Others show a cached snapshot (`runtime/snapshot.ts`), and so do frames at low zoom
- ✅ Shrink the frame runtime: load lucide icons on demand instead of `import * as Lucide`
- ✅ Reconcile on update instead of remounting the screen (`<Boundary key={version}>`), so state, scroll and images survive an edit
- ✅ Lazy-mount the recent project covers on Home; stop reading every recent project's files in Cottontail to list them

**Edit pipeline**

- ✅ Batch Tailwind `add()` per frame and build once after the first sync on open (it's O(N²) full-CSS broadcasts today). Skip candidates that can't be classes
- ✅ Debounce disk writes, the duplicate scan and component catalog while typing; the frame still updates on every keystroke
- ✅ Hover: return only the innermost box, skip `setHover` when the element didn't change
- ✅ Pause `MutationObserver`/`ResizeObserver` work in unmounted or offscreen frames

**Remaining**

- 🚧 Measure the targets in the packaged app on a 30-screen project (a dev-only "Show FPS" item is in the canvas right-click menu). First pass with 33 screens: 60 fps most of the time, but 34–45 fps while a marquee selects screens, because every selection change re-rendered the editor. Selecting also mounted a live iframe for every selected screen, so a marquee at fit zoom (below 25%, all snapshots) loaded up to 33 frames; now only a single selected screen near the view goes live. The marquee keeps its selection on the canvas and sends it to the editor once on release, and the chat history, screens list and title bar buttons no longer re-render on a selection change. Recheck; still to measure: pan, zoom and drags, 50 ms keystroke to frame, 500 ms to first frames. `bun bench/perf/perf.ts` (`hutch run bench:perf`) guards what can be measured outside the app; see `bench/perf/README.md`
- ⬜ Check in WKWebView: the swap between a live frame and its snapshot, observer pausing offscreen, lazy covers on Home, `--zoom` counter-scaling of labels, outlines and link arrows
- ⬜ A ⌘-click or double-click on a frame that is not live (mostly below 25% zoom) selects it but can miss the element while its iframe loads. "Send to chat" on a comment on a frame that is not live targets the whole screen
- ⬜ Edits keep state only for top-level `function` components and capitalized or default function exports; `const Foo = () =>` components used in their own file still remount

**Done when** the targets above hold, with a small benchmark in `bench/` that guards them.

---

## Phase 10: Drop with a placement preview 🚧

_Principle: UX first (direct manipulation over prompts)_

Dragging a component only highlights the whole screen, and the drop always appends to the nearest container. You should see exactly where it lands before you let go.

- ✅ Hit-test on dragover (throttled to one in flight, like hover), not only on drop
- ✅ The frame reports the target container's box, its direct children's boxes with their source starts, and its layout (`display`, `flex-direction`, grid flow): the `drop-layout` message, cached per container for the drag
- ✅ An insertion line between siblings along the main axis (rows, columns, reversed and RTL flex, wrapping flex and grids), a highlight on the target container, and its name as a label. Empty containers show a filled drop zone (`lib/drop-placement.ts`)
- ✅ `insertAt(source, parent, index)` in `shared/jsx/transforms.ts`, so the drop lands where the line shows. `dropTarget` picks the container for both the preview and the drop, so they always agree
- ✅ Accept more containers: component usages written with children (`<Card>`, `<CardContent>`), lists, buttons and labels. `.map` and conditional children pass the drop to the container holding the expression; a screen that failed to render shows "Can't drop here"
- ✅ Select the inserted element after the drop; Esc cancels a drag and clears the preview
- ✅ Reuse the same indicator to move an existing element (Phase 12)

**Remaining**

- ⬜ Check in WKWebView: the preview while dragging (line, label, empty drop zone), "Can't drop here" on a broken screen, Esc mid-drag, and dropping a button between two specific cards

**Done when** a user can drop a button between two specific cards, and it lands there on the first try.

---

## Phase 11: Context menus 🚧

_Principle: UX first (keyboard first, mouse friendly)_

There's no right-click anywhere. Every action exists already, but it's spread across the inspector, shortcuts and the title bar.

- ✅ The shadcn `ContextMenu` primitive, and one action registry (label, shortcut, enabled, run) shared by menus, shortcuts and the command palette (`lib/actions.ts`). The editor's key handler dispatches through it; `ActionMenuItems` renders menus from action ids
- ✅ **Screen:** rename (⌘R), duplicate, delete, copy (⌘C), copy code, copy as PNG, export, vary this, compare, pick, play from here and zoom to selection
- ✅ **Multiple screens:** align, distribute, duplicate, delete, export (the same menu, with what doesn't apply greyed)
- ✅ **Element:** edit text, select parent (⇧↵) and first child, duplicate (⌘D), delete, wrap in a div (⌥⌘G), make component (⌥⌘K), ask AI about it, copy code, go to source (`duplicateElement`, `wrapElement` in `shared/jsx/transforms.ts`)
- ✅ **Canvas:** paste (⌘V: copied screens, or TSX from the clipboard as a new screen, centered under the pointer), new blank screen and add comment at the pointer, zoom to fit, select all
- ✅ **Screens list and structure tree:** the screen and element menus
- ✅ Right-click selects what's under the pointer first, as in Figma: a screen, or an element inside the selected screen (⌘ + right-click anywhere). Menu items show their shortcut
- ✅ ⌘K command palette (the uai `command-menu` block) backed by the same registry, and a shortcut sheet (`?`)
- ⬜ **Screen:** link to. Links are a per-element attribute (decision 0007), so this belongs on the element menu

**Remaining**

- ⬜ Check in WKWebView: element menu after the async hit-test, focus after Rename, Ask AI and Make component from a menu, the clipboard prompt on ⌘V, and that ⌘R doesn't reload

**Done when** every screen and element action can be found with a right-click, and shows its shortcut.

---

## Phase 12: Element editing 🚧

_Principle: Direct manipulation over prompts_

You can select one element, edit its text and change its classes. Next: move, resize and restructure it on the canvas.

**Selection**

- ✅ Layers panel in the Design tab (the Code tab's structure tree, now `structure-tree.tsx`), with hover sync to the canvas both ways (`lib/element-hover.ts`)
- ✅ Breadcrumb of ancestors above the inspector; ↵ selects the first child (or edits text on an element without children), ⇧↵ the parent, ⇥ / ⇧⇥ the next and previous sibling (`lib/element-nav.ts`)
- ✅ ⇧-click on the canvas and ⇧/⌘-click in Layers select several elements in one screen. The style panel shows shared values or "Mixed", and an edit applies to all in one undo step (`lib/element-selection.ts`). Delete, duplicate, copy and wrap (adjacent siblings) work on all of them
- ✅ Hover label with name and size; the selection shows its size, padding and gap overlays (`lib/render/spacing.ts`)

**Manipulation**

- ✅ Drag an element to reorder it within its parent or move it to another container, with the Phase 10 indicator (`moveElement` transform, `lib/element-move.ts`)
- ✅ Arrow keys reorder an element among its siblings (`moveAmongSiblings`)
- ✅ Drag an item a `.map` renders to reorder it among its siblings: Rabisco moves its entry in the array literal (`const items = […]` or `[…].map`), as one undo step (`shared/jsx/lists.ts`). The siblings slide aside live with transforms in the frame, so the screen doesn't render mid-drag (`runtime/reorder.ts`)
- ✅ Resize handles that write `w-*` / `h-*` (snapped to the spacing scale, Fixed / Hug / Fill from the size pill, double-click a handle to hug), and drag handles for padding (⌥ all sides, ⇧ opposite sides) and gap. Drags preview inline in the frame and commit one undo step (`lib/resize.ts`)
- ✅ Duplicate (⌘D), cut, copy and paste (⌘X, ⌘C, ⌘V, between screens too, imports follow), wrap in a div (⌥⌘G) or flex stack (⇧A), unwrap (⇧⌘G)

**Properties**

- ✅ Add an attribute; an image picker for `src` that copies the file into `public/images/` (decision 0010 pushes project images to frames and exports); a link field with a screen picker for `href`
- ✅ Icon picker for lucide icons (`shared/jsx/icons.ts`)
- ✅ Missing style controls: position and inset, z-index, overflow, grid columns, flex grow and self-alignment, font family
- ✅ States and breakpoints: a State switch in the inspector edits `hover:`, `focus:`, `dark:`, `sm:`, `md:` and `lg:` classes
- ✅ Collapsible inspector sections

**Remaining**

- ⬜ Check in WKWebView: element drag, resize and padding/gap handles, ⇧-click multi-select, Layers hover sync, Tab between siblings, ⌘C/⌘V of elements (clipboard prompt), and picked images on the canvas
- ⬜ Move an element to another screen by dragging
- ⬜ Handles follow the State switch (they write base classes only), and work with several elements selected
- ⬜ Arrow keys follow the parent's main axis (↑/← always move earlier)
- ⬜ Renaming a screen updates `href="#/…"` as it does `data-link-to`
- ⬜ Images in `srcSet`, `<source>` and `new Image()` are not rewritten to project images

**Done when** a user can build a simple card from components with the mouse only, and the TSX reads like a developer wrote it.

---

## Phase 13: UX polish 🚧

_Principle: UX first_

Findings from the audit of the current editor, by impact.

**Canvas**

- ✅ New blank screen (toolbar, context menu, ⌥N), with device presets (phone, tablet, desktop, custom)
- ✅ Resize frames with handles, and more device presets
- ✅ Snapping and smart guides when moving frames
- ✅ Rename a screen by double-clicking its label
- ✅ A marker and a "Fix" action on screens that still fail to render after the automatic repair
- ✅ Tooltips with shortcuts on the zoom controls; a minimap for large projects

**Screens list**

- ✅ Move it out from under the inspector into its own panel or tab, with thumbnails, inline rename, reorder and search

**Chat**

- ✅ Paste and drop images into the composer, and keep them in the history
- ✅ Edit and resend a prompt, copy and regenerate a reply, markdown in replies
- ✅ Resizable and collapsible chat panel; a stable inspector width across tabs
- ✅ Chat sessions ([0012](./decisions/0012-chat-sessions-and-provider-commands.md)): New chat (⇧⌘O, `/new`) and a searchable history in the panel header. Each chat is `chats/<id>.jsonl`; older projects' `chat.jsonl` moves there. A generation gets its own chat's history, and CLI agents now get it too
- ✅ `/` commands in the composer: Rabisco's (`/new`, `/product-md`, `/design-md`, `/vary`, `/compare`, `/play`) and the active CLI's own command files (Claude Code, Codex, Gemini CLI), expanded by Rabisco
- ✅ Files a generation writes show as uai tool calls with a live line count; open one to read the code so far
- ✅ The chat follows new messages only while you're at the bottom, and scrolls only itself
- ✅ Double-click the title bar to zoom the window, as the macOS setting says
- ⬜ Check in WKWebView: the `/` menu's keys in the composer, ⇧⌘O from the composer, deleting a chat to the Trash, and a real Claude Code command run

**Fixed**

- ✅ The whole editor could scroll up out of the window, so the title bar disappeared (some projects only). Hidden render frames (snapshots, image export) take a screen's full size, so a tall screen made the page taller than the window, and a focus or `scrollIntoView` scrolled it. They now render in a clipped layer, and the page itself never scrolls

**First run and Home**

- ✅ First-run onboarding: pick a provider (with a detected CLI preselected), or start without one
- ✅ Search and sort recents, real dates after a week
- ✅ Follow the system theme until the user picks one

**Safety and feedback**

- ✅ A toast with "Undo" after deleting screens; confirm removing a provider
- ✅ Undo for the project name and device; warn before a reload from disk clears the history
- ✅ A comments list, with resolved threads

**Done when** a new user can go from install to an edited, shared screen without reading the README.

---

## Phase 14: Design system and tokens 🚧

_Principles: Context is a file · Component based by default_

DESIGN.md's `## Tokens` stays the one source of truth ([0009](./decisions/0009-theme-read-from-design-md.md)). DTCG and Figma JSON are for import and export only. Custom tokens use Tailwind v4 namespaces, so the name is the class. The compiler gets the token names, frames get the values ([0013](./decisions/0013-custom-tokens-names-in-the-compiler.md)).

**MVP**

- ✅ Custom tokens in DESIGN.md: `color-brand` (`bg-brand`), `radius-card` (`rounded-card`), `font-display`, `text-display: 3rem/1.1`, `spacing` and `spacing-*`, with light and dark values. Each kind has its own value whitelist; names that shadow built-ins are invalid (`src/shared/context/tokens.ts`)
- ✅ Names go into the screen compiler as `@theme reference`, values stay in the theme stylesheet: a value edit rebuilds nothing, a new name restarts the compiler once (`lib/render/tailwind.ts`, `styles.ts`)
- ✅ Edit tokens in the Context panel: name, light and dark value, add, rename and remove. Each edit is one undo step that writes DESIGN.md and the applied theme together. A theme read with AI is written into DESIGN.md before the first edit, so it isn't lost (`src/shared/context/token-edit.ts`)
- ✅ The inspector's color field lists the project's tokens with the applied theme's swatches
- ✅ Prompts list the project's tokens and the classes they make (`src/bun/ai/theme-tokens.ts`); exports map custom names in `index.css`

**Remaining:** check in the running app (WKWebView) that adding a token restarts the compiler and re-styles open frames, and that the token editor's keys (Enter, Esc, blur) behave. Run a generation with real providers and see whether it uses the custom classes.

**Later**

- ⬜ A design system view: tokens by category, rename with usages rewritten, delete with a usage count, shadows and font weights
- ⬜ Find raw values that match a token ("12 raw colors in 4 screens") and replace them in one step; detach a token back to a value
- ⬜ Import tokens from DTCG / Figma Variables JSON, pasted shadcn CSS or a tweakcn link; export `tokens.json`, `tokens.css` and a Tailwind theme
- ⬜ More modes than light and dark, with a preview switch on frames

**Done when** adding a brand color in the Context panel makes `bg-brand` work in every screen, the inspector and the next generation, and survives export.

---

## Phase 15: More of the uai kit 🚧

From a review of the uai catalog against the editor (`tool-call`, now used in the chat, was the first).

- ✅ `response-status` for the chat's failure states, keeping Try again, Open settings and Install as actions
- ✅ `empty-state` in the chat, comments list, components panel and context panel
- ✅ `attachment` for images in chat messages, and `citation` for "Followed DESIGN.md · PRODUCT.md"
- ✅ A change summary at the end of a generation, full width in the chat: a file tree with added and removed lines, problems left, Undo, and the diff with `@pierre/diffs` (`src/shared/change-summary.ts`, `views/editor/change-summary.tsx`)
- ✅ Expose uai blocks to generated screens as `@/components/ui/uai/<name>`: message, prompt-composer, thinking, metric-card, status-banner, step-indicator, search-field, form-field and form-error-summary, plus the `label` primitive. Their classes seed the screen compiler, and exports ship their sources ([0014](./decisions/0014-uai-blocks-in-screens.md))

**Remaining:** check in the running app (WKWebView) how the new chat cards and popovers fit a narrow panel, and how the blocks look under a DESIGN.md theme and in dark mode. Check that snapshots don't catch entry animations half-drawn. Pressing Stop still writes a "Stopped" chat message instead of the stopped status.

---

## Phase 16: Generation quality 🚧

_Principles: UX first (a bad generation costs one keystroke) · Context is a file · Screens are React_

Today a generation is checked only for code: path, compile, imports, exports and render errors. Nothing checks how the screen looks. A project without DESIGN.md gets the generic look of the model. Fix that in this order: measure, then give the model a direction, then check what it made.

**Measure first**

- ✅ A generation eval in `bench/gen` (`hutch run bench:gen -- --model …`, or `--mock`): 12 fixed briefs (mobile, tablet, desktop; empty and themed projects; create, edit, point and prompt, vary). It runs through the real AI layer with the app's providers, and writes each brief as a project folder you can open in Rabisco
- ✅ Design checks with no AI, from the rendered frame (`src/shared/design/layout-checks.ts`, collected by `runtime/design-lint.ts` through a `lint` frame message): content wider than the frame, clipped text, overlapping siblings, contrast under 4.5:1 (3:1 for large text), empty containers, more than 6 font sizes on a screen or 3 in a card. From the source (`source-checks.ts`): neutral and arbitrary colors where a theme token exists, and more than 2 palette color families. Each finding has a path and a line from `data-rabisco-loc`
- ✅ "Check design" in the command palette: renders the selected screens (or all) offstage, lists the findings by screen, selects the element on click, and copies them as JSON
- ✅ Score each eval run (`bench/gen/score.ts`): ok and error codes, repair attempts, files, time, tokens and cost, raw colors, project component reuse, UI and uai module use, custom token use, lines changed outside a focused element. `report.json` stores `PROMPT_VERSION`; `--baseline` prints the change in each total
- ⬜ Run the eval with real providers (API, Claude Code, Ollama) and keep the first report as the baseline
- ✅ Layout findings in the eval report: the eval renders each written screen with the real screen runtime in headless Chrome (`playwright-core`) and runs the same layout checks as "Check design". Findings already in a seed screen don't count. `--rescore <run>` checks an earlier run without generating again; `--no-layout` skips the checks
- ✅ Tablet is a real device: the composer has a tablet option, and generation designs at 834×1194 with its own layout guidance

**Direction before generation**

- ✅ Style direction on Home: a Style picker in the composer with five starting points (Minimal, Editorial, Playful, Dense data, Bold) and "No style". Each writes a starter DESIGN.md with light and dark tokens and rules, so screens render themed with no AI step (`src/shared/context/styles.ts`). Minimal is the default; the choice is remembered. Every text and fill pair is tested at 4.5:1. `bench:gen --style <id>` starts the briefs without a DESIGN.md from a style. Measured with Claude Code (Opus) on the 5 briefs without a DESIGN.md: new raw colors went from 22 to 1, at the same cost
- ✅ The same styles in the empty chat while DESIGN.md is missing or still the template, and "Start from a style…" in the command palette. Picking one writes DESIGN.md and applies its tokens to the screens as one undo step, with Undo in the toast
- ✅ "Auto" in the Style picker: a new project writes DESIGN.md from its first prompt with a `context` task, then applies its tokens, before the plan and the screens. The chat shows "Writing DESIGN.md from your prompt". DESIGN.md and its theme are one undo step, separate from the screens, so undoing the screens keeps the look. If it fails or has no tokens, the project starts from Minimal and the chat says so. Minimal stays the default; Auto is opt-in
- ✅ Plan, then screens ([0015](./decisions/0015-plan-then-screens.md)): a create first runs a short `plan` task. The plan lists the screens, the shared components and the links between screens. It shows in the chat as a checklist: untick a screen or component, rename a screen, then Generate or ↵. It starts by itself after 5 s, unless you touch it. A plan of one screen with nothing shared runs at once. The eval plans its create briefs; `--no-plan` compares with the old one-shot create
- ✅ Shared shell first: the plan's components are written in one run, then each screen in its own run, in parallel. Screens get the components as references and the plan's links as `data-link-to`. Everything is one undo step and one change summary
- ✅ Better prompt rules (`prompt.ts`): a layout pattern per device (mobile top bar, tab bar, safe areas and 44px targets; desktop sidebar and content width), a type scale, a 4px spacing rhythm, one focal point and one primary button per screen, hierarchy without nested cards, realistic density, 4.5:1 text contrast, and states (empty, loading, error) only when the request names them. DESIGN.md still wins. The system prompt grew by about 450 tokens (≈4 characters a token). `PROMPT_VERSION` 15. The eval comparison with real providers is still to run
- ✅ Image placeholders ([0016](./decisions/0016-image-placeholders.md)): `@/components/ui/placeholder` draws photos (landscape, food, interior, product, people, abstract), avatars, maps with a pin, charts (area, line, bar) and illustrations (tiles, empty, success, error) as SVG. The same seed draws the same image. Everything but photos follows the theme. No bundled assets; about 7.5 kB gzipped. The prompt tells the model to use it instead of network images

**Check after generation**

- ✅ Design checks feed the repair loop: after a create, edit or vary, the webview checks the screens it wrote offstage ("Checking the design"). Errors (overflow, clipped text, contrast under 3:1) become the problems of one `repair` run ("Polishing 2 problems") that may only rewrite existing files, and its writes join the generation's undo step. The change summary lists the findings left as "design notes", collapsed, by file; a click selects the element and "Fix" sends a focused repair. "Polish after generating" in AI providers turns the polish off (`src/shared/design/polish.ts`)
- ✅ Visual review: the polish also sends a JPEG of each new screen with the prompt, DESIGN.md and the check's findings, and the model fixes only clear visual problems ("Reviewing screenshots", "Applying review"). It is on by default and merged into the polish run, so it adds one call and no undo step. "Review screenshots after generating" in AI providers turns it off. A model that can't see images gets the plain polish ([0019](decisions/0019-visual-review.md))

**Edits**

- ✅ Search-and-replace edits for API providers: edits and repairs send `<rabisco-edit path>` blocks that must match exactly once, and a block that doesn't match asks once for the whole file ([0018](./decisions/0018-search-replace-edits.md))
- ✅ "Improve prompt" in the composer, on Home and in the chat (wand button or `⌘I`): a `brief` task ([0017](./decisions/0017-brief-task-and-fast-model.md)) expands the prompt with PRODUCT.md and DESIGN.md's direction, and streams the brief into the field for editing. It never sends. "Undo improve" or `⌘Z` puts the original back
- ✅ Model per task: an optional "Fast model" in Settings runs edits, fixes, plans, DESIGN.md and theme reads, and Improve prompt. Create and vary keep the model picked in the composer. The main process picks the model, and an unavailable fast model falls back to the picked one ([0017](./decisions/0017-brief-task-and-fast-model.md))

**Done when** the eval shows fewer design findings and higher token and component reuse than today's baseline with the same provider, and a new project with no DESIGN.md still gets a consistent, intentional look.

---

## Phase 17: Figma parity ⬜

_Principles: Direct manipulation over prompts · Keyboard first (Figma conventions)_

Designers come with Figma habits. Rabisco has selection, layers, auto layout through flex classes, align, resize and comments. It has no insert tools: you can't draw a box or type a text layer. Each tool here writes plain TSX and Tailwind, so the code still reads like a developer wrote it.

**Insert tools** (most used first)

- ⬜ Text (T): click inside a screen to add a `<p>` at the drop placement (Phase 10) and edit it in place; drag to set a width
- ⬜ Frame (F, A): drag on the empty canvas to make a new screen of that size; drag inside a screen to add a `<div>` with `w-*`/`h-*` and the Phase 10 placement. Device presets in the inspector while the tool is active
- ⬜ Rectangle (R) and ellipse (O): a `<div>` with `bg-muted` and the radius token; ellipse adds `rounded-full`
- ⬜ Image (⇧⌘K): pick a file, it lands in `public/images/` (decision 0010) at the pointer
- ⬜ The tool bar shows the active tool; ↵ after insert selects the new element; Esc returns to Move (V)

**Inspect and measure**

- ⬜ ⌥ + hover: red distance lines and values between the selection and the hovered element or its parent
- ⬜ Layout grid per screen (⌃G): columns and margins drawn over the frame, stored in `rabisco.json`
- ⬜ ⇧2 zoom to selection, ⇧0 zoom to 100%

**Properties**

- ⬜ Copy and paste properties (⌥⌘C / ⌥⌘V): copy an element's classes without its variants and children, paste onto one or many elements, one undo step
- ⬜ Eyedropper (I) in the color field: pick a color from any frame, and snap it to the matching token when one exists
- ⬜ Auto layout panel the way Figma shows it: direction, wrap, a 3×3 alignment grid, gap and padding with "Auto" (`justify-between`), on top of the existing flex classes
- ⬜ Hide (⇧⌘H) and lock (⇧⌘L) in Layers. Hide writes `hidden` in the TSX so exports match; lock is canvas state in `rabisco.json`
- ⬜ Select matching (⌥⌘A): elements with the same component or the same classes, across the screen

**Organize**

- ⬜ Sections on the canvas (⇧S): a named, colored area that holds screens and moves with them, stored in `rabisco.json`. The screens list groups by section
- ⬜ Find and replace text across screens (⌘F on the canvas): results by screen, replace one or all as one undo step
- ⬜ Version history panel: named checkpoints (⌥⌘S) and the AI changes in the session, each with a preview and Restore. Builds on undo history and git sync, with no new storage when git is set up

**Prototype**

- ⬜ Transitions on links (instant, dissolve, slide, push) as `data-link-transition`, played in play mode and the share viewer
- ⬜ Overlays: open a screen as a modal or sheet over the current one (`data-link-mode="overlay"`). Extends [0007](./decisions/0007-prototype-links-in-source.md) with a new record

**Done when** a Figma user can draw a frame, add text, a box and an image, measure spacing with ⌥ and organize screens into sections, with no prompt and no README.

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
- **Component structure:** read from the TSX source with Sucrase's tokenizer, not from the rendered DOM ([0006](./decisions/0006-components-from-source.md)).
- **Prototype links:** a `data-link-to` attribute in the TSX, so links survive edits and export ([0007](./decisions/0007-prototype-links-in-source.md)).
- **Share and git:** a read-only link is a static viewer that the main process serves on the local network, with no account or server. Git sync runs the system `git` CLI, scoped to the project folder, and never force-pushes ([0008](./decisions/0008-share-link-and-git-sync.md)).
