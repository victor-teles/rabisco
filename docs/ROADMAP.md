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
    chat.jsonl          # conversation history
    attachments/        # images attached to prompts, referenced from chat.jsonl
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
- ✅ Map DESIGN.md tokens (`## Tokens`, `- primary: oklch(…)`, `### Dark`) to the theme variables. Frames get the overrides as a second stylesheet, so a token change re-themes every screen with no Tailwind rebuild (`src/shared/context/tokens.ts`)
- ✅ Import the files from an existing repository (root, `docs/`, `design/`, `.github/`…)

**Remaining:** in the running app, check import from a repository (folder picker, replace dialog), the `context` task with real providers (API, Claude Code, Ollama), and that a token change re-themes open frames in WKWebView.

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
- ✅ Comments and pins on the canvas (C): pinned to a screen or the canvas, threads with replies, resolve, drag to move, undoable, saved in `rabisco.json`. "Ask AI" sends a comment as a prompt for the element under its pin
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

- ⬜ A generated screen is written to disk and renders; an edit in VS Code updates the canvas (Phase 1)
- ⬜ Confirm the RPC round-trip floor fix ([0005](./decisions/0005-rpc-round-trip-floor.md))
- ⬜ Hit tests through the fiber tree, text editing (focus, caret, Enter/Esc), play mode clicks, drag and drop from the Components panel, the editable code view
- ⬜ Context import (folder picker, replace dialog), and a DESIGN.md token change re-themes open frames
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

## Phase 9: Performance and snappy interactions ⬜

_Principle: UX first (fast feedback)_

Today every wheel, pan and drag event re-renders the whole editor, every screen is a live iframe with its own 1.2 MB runtime, and each keystroke writes to disk and remounts the screen. Fix the hot paths first, so the editing work in the next phases starts from a fast base.

**Targets** (measured in the packaged app on a 30-screen project)

- Pan and zoom hold 120 fps (ProMotion), with no React render of the editor per event
- Dragging a frame or a pin holds 120 fps and is one history commit
- A keystroke in the code view or a style field shows in the frame within 50 ms
- Opening a project shows the first frames within 500 ms, with one Tailwind build

**Canvas**

- ⬜ Keep the viewport out of React state: write the transform to the DOM in requestAnimationFrame, and update the zoom readout lazily
- ⬜ Pass zoom to counter-scaled chrome (labels, outlines, link connectors) as a `--zoom` CSS variable, so frames stay memoized while zooming
- ⬜ Draw the dot grid on its own layer; add `will-change: transform` during a gesture; cheaper frame shadows
- ⬜ Frame, pin and field drags update a transient layer and commit once on pointerup (`use-project.ts` `change()` runs per pointermove today)
- ⬜ Memoize the editor panels (chat, inspector, code view lines) and stabilize inline props (`exportContext`, `overlay`, zoom handlers)

**Frames**

- ⬜ Mount only frames in or near the viewport. Others show a cached snapshot (`runtime/snapshot.ts`), and so do frames at low zoom
- ⬜ Shrink the frame runtime: load lucide icons on demand instead of `import * as Lucide`
- ⬜ Reconcile on update instead of remounting the screen (`<Boundary key={version}>`), so state, scroll and images survive an edit
- ⬜ Lazy-mount the recent project covers on Home; stop reading every recent project's files in Cottontail to list them

**Edit pipeline**

- ⬜ Batch Tailwind `add()` per frame and build once after the first sync on open (it's O(N²) full-CSS broadcasts today). Skip candidates that can't be classes
- ⬜ Debounce disk writes, the duplicate scan and component catalog while typing; the frame still updates on every keystroke
- ⬜ Hover: return only the innermost box, skip `setHover` when the element didn't change
- ⬜ Pause `MutationObserver`/`ResizeObserver` work in unmounted or offscreen frames

**Done when** the targets above hold, with a small benchmark in `bench/` that guards them.

---

## Phase 10: Drop with a placement preview ⬜

_Principle: UX first (direct manipulation over prompts)_

Dragging a component only highlights the whole screen, and the drop always appends to the nearest container. You should see exactly where it lands before you let go.

- ⬜ Hit-test on dragover (throttled to one in flight, like hover), not only on drop
- ⬜ The frame reports the target container's box, its direct children's boxes with their source starts, and its layout (`display`, `flex-direction`, grid flow)
- ⬜ An insertion line between siblings along the main axis, a highlight on the target container, and its name as a label. Empty containers show a filled drop zone
- ⬜ `insertAt(source, parent, index)` in `shared/jsx/transforms.ts`, so the drop lands where the line shows. `dropParent` returns the container it picked, so the preview and the result always agree
- ⬜ Accept more containers: component usages that take `children` (`<Card>`, `<CardContent>`), lists and buttons. A clear "can't drop here" state for `.map` and conditional children
- ⬜ Select the inserted element after the drop; Esc cancels a drag
- ⬜ Reuse the same indicator to move an existing element (Phase 12)

**Done when** a user can drop a button between two specific cards, and it lands there on the first try.

---

## Phase 11: Context menus ⬜

_Principle: UX first (keyboard first, mouse friendly)_

There's no right-click anywhere. Every action exists already, but it's spread across the inspector, shortcuts and the title bar.

- ⬜ Add the shadcn `ContextMenu` primitive, and one action registry (label, shortcut, enabled, run) shared by menus, shortcuts and a command palette
- ⬜ **Screen:** rename, duplicate, delete, copy code, copy as PNG, export, vary this, compare, pick, play from here, link to and zoom to selection
- ⬜ **Multiple screens:** align, distribute, duplicate, delete, export
- ⬜ **Element:** edit text, select parent and children, duplicate, delete, wrap in a div, make component, ask AI about it, copy code, go to source
- ⬜ **Canvas:** paste, new blank screen, add comment, zoom to fit, select all
- ⬜ **Screens list and structure tree:** the same menus as the canvas
- ⬜ Right-click selects what's under the pointer first, as in Figma. Menu items show their shortcut
- ⬜ ⌘K command palette backed by the same registry, and a shortcut sheet (`?`)

**Done when** every screen and element action can be found with a right-click, and shows its shortcut.

---

## Phase 12: Element editing ⬜

_Principle: Direct manipulation over prompts_

You can select one element, edit its text and change its classes. Next: move, resize and restructure it on the canvas.

**Selection**

- ⬜ Layers panel in the Design tab (the Code tab's structure tree, made reusable), with hover sync to the canvas
- ⬜ Breadcrumb of ancestors above the inspector; Enter / ⇧Enter to select children and parent, Tab between siblings
- ⬜ ⇧-click selects several elements; shared style edits apply to all of them
- ⬜ Hover label with size; the selection shows padding and gap overlays

**Manipulation**

- ⬜ Drag an element to reorder it within its parent or move it to another container, with the Phase 10 indicator (`moveElement` transform)
- ⬜ Arrow keys reorder an element among its siblings
- ⬜ Resize handles that write `w-*` / `h-*` (snapped to the spacing scale, `fill`/`hug` like Figma's auto layout), and drag handles for padding and gap
- ⬜ Duplicate (⌘D), copy and paste (between screens too), wrap in a div or flex stack (⌥⌘G), unwrap

**Properties**

- ⬜ Add an attribute; an image picker for `src` that copies the file into the project; a link field with a screen picker for `href`
- ⬜ Icon picker for lucide icons
- ⬜ Missing style controls: position and inset, z-index, overflow, grid columns, flex grow and self-alignment, font family
- ⬜ States and breakpoints: edit `hover:`, `focus:`, `dark:` and `md:` classes through a state switch in the inspector
- ⬜ Collapsible inspector sections

**Done when** a user can build a simple card from components with the mouse only, and the TSX reads like a developer wrote it.

---

## Phase 13: UX polish ⬜

_Principle: UX first_

Findings from the audit of the current editor, by impact.

**Canvas**

- ⬜ New blank screen (toolbar, context menu, ⌥N), with device presets (phone, tablet, desktop, custom)
- ⬜ Resize frames with handles, and more device presets
- ⬜ Snapping and smart guides when moving frames
- ⬜ Rename a screen by double-clicking its label
- ⬜ A marker and a "Fix" action on screens that still fail to render after the automatic repair
- ⬜ Tooltips with shortcuts on the zoom controls; a minimap for large projects

**Screens list**

- ⬜ Move it out from under the inspector into its own panel or tab, with thumbnails, inline rename, reorder and search

**Chat**

- ⬜ Paste and drop images into the composer, and keep them in the history
- ⬜ Edit and resend a prompt, copy and regenerate a reply, markdown in replies
- ⬜ Resizable and collapsible chat panel; a stable inspector width across tabs

**First run and Home**

- ⬜ First-run onboarding: pick a provider (with a detected CLI preselected), or start without one
- ⬜ Search and sort recents, real dates after a week
- ⬜ Follow the system theme until the user picks one

**Safety and feedback**

- ⬜ A toast with "Undo" after deleting screens; confirm removing a provider
- ⬜ Undo for the project name and device; warn before a reload from disk clears the history
- ⬜ A comments list, with resolved threads

**Done when** a new user can go from install to an edited, shared screen without reading the README.

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
