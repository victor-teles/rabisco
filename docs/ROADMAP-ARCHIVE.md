# Rabisco roadmap archive

Finished work from phases 0–22, kept for reference. Each item says what was built and where it lives. Open items from these phases moved to the [roadmap](./ROADMAP.md).

Status: ✅ done · ❌ dropped

---

## Phase 0: Foundation

The shell of the app, with a mock generator.

- ✅ Electrobun 2 app (Hutch, Cottontail) with React 19, Tailwind v4, shadcn/ui and the uai theme
- ✅ Typed RPC between the main process and the webview, with a localStorage fallback for the browser
- ✅ Home: prompt, device and model pickers, recent projects
- ✅ Editor: chat panel, infinite canvas (pan, zoom, drag, fit), inspector, screen list
- ✅ Projects saved as JSON in the userData directory
- ✅ Mock generator that returns HTML screens (`src/shared/mock-generator.ts`)

---

## Phase 1: React screens and project files

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
- ✅ Mock generator outputs TSX that uses shadcn components

**UX basics**

- ✅ Undo and redo for every canvas and AI change (⌘Z / ⇧⌘Z)
- ✅ Multi-select, marquee selection, align and distribute
- ✅ Code view for the selected screen (editable since Phase 5)

**Done when** a generated screen is a `.tsx` file on disk that renders on the canvas, and editing that file in VS Code updates the canvas.

---

## Phase 2: AI providers

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

**Done when** the same prompt works with an API key, with the Claude Code CLI and with a local Ollama model, and nothing outside the provider layer changes.

---

## Phase 3: PRODUCT.md and DESIGN.md

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

**Done when** changing the primary color or the voice in the files changes the next generation, with no extra prompt.

---

## Phase 4: Variations

_Principle: Variations, not verdicts_

- ✅ Choose how many variations to generate (1–4) in the composer, on Home and in the chat. The choice is remembered. With screens selected, prompts edit them and the count is ignored
- ✅ Variations run as N parallel generations of the same task, and Rabisco names the files `*.alt-N.tsx` as they stream in ([0004](./decisions/0004-alternates-are-files.md), `src/shared/ai/variants.ts`). Components a variation writes get a `-vN` name unless they match the primary's
- ✅ Variations appear as a group on the canvas: one row per variation, a dashed outline with a "Compare" chip, "Picked" and "Pick" on the frame labels
- ✅ Compare mode (⇧V or the chip): variations side by side at the same zoom, with a synced scroll. Frames report their content height, so every column scrolls in one container
- ✅ Pick one. Picking swaps file contents, so `welcome.tsx` is always the chosen version and imports keep working. It is one undo step
- ✅ "Vary this" (inspector): new variations from a selected screen, with an optional direction ("bolder", "denser")
- ✅ Mix (inspector): take a section from one variation into another, as an edit that reads the source variation without changing it

**Done when** a user can generate 3 versions of a screen, compare them, keep one and come back to the others later.

---

## Phase 5: Components and design system

_Principle: Component based by default_ ([0006](./decisions/0006-components-from-source.md))

- ✅ Components panel (Components tab, ⌥2): project components plus the shadcn library (`src/shared/components/library.ts`), searchable, with live previews and a variant grid. Previews render lazily in sandboxed frames
- ✅ Drag a component onto a screen: the frame hit-tests the drop point (`data-rabisco-loc`), and Rabisco inserts the component into the nearest container element, with its import, as one undo step
- ✅ "Make component" (⌥⌘K, from the Structure outline in the Code tab): extract the selected structure to `components/*.tsx`, and replace it everywhere it repeats. Text and string attributes that differ become props (`src/shared/jsx/extract.ts`)
- ✅ Edit a component once, and every screen updates: select it in the Components tab, then edit it with a prompt or in the code view (now editable). Frames re-render when any module they import changes
- ✅ Props and variants appear as controls in the inspector, for project components and shadcn components (`prop-controls.tsx`)
- ✅ The generator reuses project components first: every request carries a catalog of component signatures, and validation rejects a new component that re-exports an existing name
- ✅ Rabisco suggests a component when it finds duplicate structure (Suggestions in the Components tab). You can make it a component or dismiss it

**Done when** changing a button component updates it on every screen, and new generations use that component.

---

## Phase 6: Direct editing

_Principle: UX first (direct manipulation over prompts)_

- ✅ Select an element inside a screen: click inside the selected screen (or ⌘-click any screen), hover outlines, Esc walks up to the parent. Every element, component usages included, carries `data-rabisco-loc`; the runtime reads it from React's fiber tree, so a `<StatCard>` maps back to its JSX even when it doesn't pass props on (`src/mainview/runtime/inspect.ts`). The selection is the Structure selection in the Code tab
- ✅ Edit text inline: double-click (or Enter) edits the text inside the frame, with the screen's own fonts; Enter keeps it as one undo step, Esc cancels (`runtime/text-edit.ts`)
- ✅ Inspector for the selected element: layout, spacing, size, type, fill, border and effects, read from and written back to its Tailwind classes; only classes without a variant change (`src/shared/tailwind/classes.ts`, `element-style.tsx`)
- ✅ Point and prompt: with an element selected, a prompt changes only that element. The request carries its snippet and lines, and the reply notes changes made outside it (`src/shared/ai/focus.ts`, `src/shared/ai/focus-guard.ts`)
- ✅ Comments and pins on the canvas (C): pinned to a screen or the canvas, threads with replies, resolve, drag to move, undoable, saved in `rabisco.json`. "Send to chat" puts a comment in the composer, targeting the element under its pin. "Send comments to chat" (screen menu, command palette) puts all of a screen's open comments there as one list. Both add to what is already typed, so you can review before sending. When the AI changes the design for a prompt sent from comments, those comments are resolved in the same undo step, with a toast to reopen them. AI providers settings can turn this off. Resolving fades the pin out instead of removing it at once
- ✅ Prototype links between screens, plus a play mode ([0007](./decisions/0007-prototype-links-in-source.md)): "Link to" in the inspector writes `data-link-to` in the TSX, connectors on the canvas, and play mode (⌥⌘↵) runs the screens interactively with back and forward

**Done when** most small changes need no prompt.

---

## Phase 7: Export and handoff

_Principle: Screens are React (what you see is what you ship)_

- ✅ Copy a screen or a component as code: Export → "Copy code" copies the open component or the first selected screen verbatim. "Copy with components" adds the project files it imports, transitively, each headed by its path (`src/shared/export/code.ts`, `src/mainview/views/editor/export/code-export.ts`)
- ✅ Export a runnable Vite + React + Tailwind project (screens, components, theme): screens and components copied verbatim to `src/screens` and `src/components`, only the shadcn components they use (and their ui imports), the canvas theme with DESIGN.md tokens, `package.json` from the packages the files import, and an `App.tsx` hash router that follows `data-link-to` from the first frame. Alternates are left out (`src/shared/export/vite-project.ts`)
- ✅ Export images (PNG, SVG) and a PDF of the flow: Export → PNG (2x), SVG or "PDF of the flow", for the selected screens or every screen except alternates. Each screen renders in a hidden frame at its full content height, and the runtime reads the DOM into a scene of boxes, text lines, images and SVG paths (`runtime/snapshot.ts`). SVG is real shapes and text in sRGB, readable by design tools; PNG and the PDF's JPEGs are painted from the same scene on a canvas (`runtime/raster.ts`), since WebKit taints a canvas that draws an SVG `<foreignObject>`. The PDF has an overview page, then one page per screen in flow order (prototype links breadth-first from the first screen), with clickable links between pages and bookmarks, written by a small dependency-free PDF writer (`src/shared/export/scene.ts`, `pdf.ts`, `flow.ts`, `export/image-export.ts`)
- ✅ Share a read-only link ([0008](./decisions/0008-share-link-and-git-sync.md)): Share → Link serves a static viewer on the local network (`http://<LAN IP>:<port>/<token>/`) with copy, open, "Update link" and "Stop sharing". The viewer plays the picked screens with the real screen runtime, the same compiled modules, Tailwind CSS and DESIGN.md tokens as the canvas, and follows `data-link-to`. The server is read-only (GET only, a random token, files in memory). "Export as website…" writes the same viewer to a folder that works on any static host and from `file://` (`src/shared/share/viewer.ts`, `src/mainview/lib/share-snapshot.ts`, `src/bun/share.ts`)
- ✅ Sync to a git repository ([0008](./decisions/0008-share-link-and-git-sync.md)): Share → Git shows the branch, remote, changes, ahead/behind and last commit. "Set up git" runs `git init` with a `.gitignore` and a first commit, and you can add or change the remote. "Sync" commits the project folder with a generated message (`Rabisco: add settings screen, update DESIGN.md`), rebases onto the remote and pushes, never forcing. A conflict aborts the rebase and leaves the repository clean. Inside a bigger repository, only the project folder is committed. Pulled files reach the canvas through the folder watcher (`src/bun/git.ts`, `src/shared/git.ts`, `export/git-section.tsx`)

---

## Phase 8: Finish and verify

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

**Real providers**

- ✅ Embed the Claude Agent SDK native binary in the app bundle (`pathToClaudeCodeExecutable`)

**Packaging**

- ✅ The runtime bundle path `views/mainview/runtime` resolves in a packaged build (checked in an unpacked canary build, with `app/bin/claude`)

**Done when** every phase above can be marked ✅.

---

## Phase 9: Performance and snappy interactions

_Principle: UX first (fast feedback)_

Today every wheel, pan and drag event re-renders the whole editor, every screen is a live iframe with its own 1.2 MB runtime, and each keystroke writes to disk and remounts the screen. Fix the hot paths first, so the editing work in the next phases starts from a fast base.

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

**Done when** the performance targets (now in Phase 18 of the [roadmap](./ROADMAP.md)) hold, with a small benchmark in `bench/` that guards them.

---

## Phase 10: Drop with a placement preview

_Principle: UX first (direct manipulation over prompts)_

Dragging a component only highlights the whole screen, and the drop always appends to the nearest container. You should see exactly where it lands before you let go.

- ✅ Hit-test on dragover (throttled to one in flight, like hover), not only on drop
- ✅ The frame reports the target container's box, its direct children's boxes with their source starts, and its layout (`display`, `flex-direction`, grid flow): the `drop-layout` message, cached per container for the drag
- ✅ An insertion line between siblings along the main axis (rows, columns, reversed and RTL flex, wrapping flex and grids), a highlight on the target container, and its name as a label. Empty containers show a filled drop zone (`lib/drop-placement.ts`)
- ✅ `insertAt(source, parent, index)` in `shared/jsx/transforms.ts`, so the drop lands where the line shows. `dropTarget` picks the container for both the preview and the drop, so they always agree
- ✅ Accept more containers: component usages written with children (`<Card>`, `<CardContent>`), lists, buttons and labels. `.map` and conditional children pass the drop to the container holding the expression; a screen that failed to render shows "Can't drop here"
- ✅ Select the inserted element after the drop; Esc cancels a drag and clears the preview
- ✅ Reuse the same indicator to move an existing element (Phase 12)

**Done when** a user can drop a button between two specific cards, and it lands there on the first try.

---

## Phase 11: Context menus

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

**Done when** every screen and element action can be found with a right-click, and shows its shortcut.

---

## Phase 12: Element editing

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

**Done when** a user can build a simple card from components with the mouse only, and the TSX reads like a developer wrote it.

---

## Phase 13: UX polish

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
- ✅ Back to Home doesn't stop a generation: the run, its review and a waiting plan keep going, the project card shows the progress, and a toast offers Open when it's done. The result is one undo step when you come back ([0021](./decisions/0021-generations-outlive-the-editor.md))

**Done when** a new user can go from install to an edited, shared screen without reading the README.

---

## Phase 14: Design system and tokens

_Principles: Context is a file · Component based by default_

DESIGN.md's `## Tokens` stays the one source of truth ([0009](./decisions/0009-theme-read-from-design-md.md)). DTCG and Figma JSON are for import and export only. Custom tokens use Tailwind v4 namespaces, so the name is the class. The compiler gets the token names, frames get the values ([0013](./decisions/0013-custom-tokens-names-in-the-compiler.md)).

**MVP**

- ✅ Custom tokens in DESIGN.md: `color-brand` (`bg-brand`), `radius-card` (`rounded-card`), `font-display`, `text-display: 3rem/1.1`, `spacing` and `spacing-*`, with light and dark values. Each kind has its own value whitelist; names that shadow built-ins are invalid (`src/shared/context/tokens.ts`)
- ✅ Names go into the screen compiler as `@theme reference`, values stay in the theme stylesheet: a value edit rebuilds nothing, a new name restarts the compiler once (`lib/render/tailwind.ts`, `styles.ts`)
- ✅ Edit tokens in the Context panel: name, light and dark value, add, rename and remove. Each edit is one undo step that writes DESIGN.md and the applied theme together. A theme read with AI is written into DESIGN.md before the first edit, so it isn't lost (`src/shared/context/token-edit.ts`)
- ✅ The inspector's color field lists the project's tokens with the applied theme's swatches
- ✅ Prompts list the project's tokens and the classes they make (`src/bun/ai/theme-tokens.ts`); exports map custom names in `index.css`

**Done when** adding a brand color in the Context panel makes `bg-brand` work in every screen, the inspector and the next generation, and survives export.

---

## Phase 15: More of the uai kit

From a review of the uai catalog against the editor (`tool-call`, now used in the chat, was the first).

- ✅ `response-status` for the chat's failure states, keeping Try again, Open settings and Install as actions
- ✅ `empty-state` in the chat, comments list, components panel and context panel
- ✅ `attachment` for images in chat messages, and `citation` for "Followed DESIGN.md · PRODUCT.md"
- ✅ A change summary at the end of a generation, full width in the chat: a file tree with added and removed lines, problems left, Undo, and the diff with `@pierre/diffs` (`src/shared/change-summary.ts`, `views/editor/change-summary.tsx`)
- ✅ Expose uai blocks to generated screens as `@/components/ui/uai/<name>`: message, prompt-composer, thinking, metric-card, status-banner, step-indicator, search-field, form-field and form-error-summary, plus the `label` primitive. Their classes seed the screen compiler, and exports ship their sources ([0014](./decisions/0014-uai-blocks-in-screens.md))

---

## Phase 16: Generation quality

_Principles: UX first (a bad generation costs one keystroke) · Context is a file · Screens are React_

Today a generation is checked only for code: path, compile, imports, exports and render errors. Nothing checks how the screen looks. A project without DESIGN.md gets the generic look of the model. Fix that in this order: measure, then give the model a direction, then check what it made.

**Measure first**

- ✅ A generation eval in `bench/gen` (`hutch run bench:gen -- --model …`, or `--mock`): 12 fixed briefs (mobile, tablet, desktop; empty and themed projects; create, edit, point and prompt, vary). It runs through the real AI layer with the app's providers, and writes each brief as a project folder you can open in Rabisco
- ✅ Design checks with no AI, from the rendered frame (`src/shared/design/layout-checks.ts`, collected by `runtime/design-lint.ts` through a `lint` frame message): content wider than the frame, clipped text, overlapping siblings, contrast under 4.5:1 (3:1 for large text), empty containers, more than 6 font sizes on a screen or 3 in a card. From the source (`source-checks.ts`): neutral and arbitrary colors where a theme token exists, and more than 2 palette color families. Each finding has a path and a line from `data-rabisco-loc`
- ✅ "Check design" in the command palette: renders the selected screens (or all) offstage, lists the findings by screen, selects the element on click, and copies them as JSON
- ✅ Score each eval run (`bench/gen/score.ts`): ok and error codes, repair attempts, files, time, tokens and cost, raw colors, project component reuse, UI and uai module use, custom token use, lines changed outside a focused element. `report.json` stores `PROMPT_VERSION`; `--baseline` prints the change in each total
- ✅ Layout findings in the eval report: the eval renders each written screen with the real screen runtime in headless Chrome (`playwright-core`) and runs the same layout checks as "Check design". Findings already in a seed screen don't count. `--rescore <run>` checks an earlier run without generating again; `--no-layout` skips the checks
- ✅ Tablet is a real device: the composer has a tablet option, and generation designs at 834×1194 with its own layout guidance

**Direction before generation**

- ✅ Style direction on Home: a Style picker in the composer with five starting points (Minimal, Editorial, Playful, Dense data, Bold) and "No style". Each writes a starter DESIGN.md with light and dark tokens and rules, so screens render themed with no AI step (`src/shared/context/styles.ts`). Minimal is the default; the choice is remembered. Every text and fill pair is tested at 4.5:1. `bench:gen --style <id>` starts the briefs without a DESIGN.md from a style. Measured with Claude Code (Opus) on the 5 briefs without a DESIGN.md: new raw colors went from 22 to 1, at the same cost
- ✅ The same styles in the empty chat while DESIGN.md is missing or still the template, and "Start from a style…" in the command palette. Picking one writes DESIGN.md and applies its tokens to the screens as one undo step, with Undo in the toast
- ✅ "Auto" in the Style picker: a new project writes DESIGN.md from its first prompt with a `context` task, then applies its tokens, before the plan and the screens. The chat shows "Writing DESIGN.md from your prompt". DESIGN.md and its theme are one undo step, separate from the screens, so undoing the screens keeps the look. If it fails or has no tokens, the project starts from Minimal and the chat says so. Minimal stays the default; Auto is opt-in
- ✅ Plan, then screens ([0015](./decisions/0015-plan-then-screens.md), [0020](./decisions/0020-plan-mode.md)): with "Plan first" on in the composer (`⇧⌘P`, off by default, remembered), a create first runs a short `plan` task. The plan lists the screens, the shared components and the links between screens. It shows in the chat as a checklist and waits: untick a screen or component, rename a screen, then Generate or ↵. Esc cancels it. A reply in the chat revises it. With plan mode off, a create runs in one go. The eval runs one-shot creates; `--plan` plans its create briefs
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

## Phase 17: Figma parity

_Principles: Direct manipulation over prompts · Keyboard first (Figma conventions)_

Designers come with Figma habits. Rabisco has selection, layers, auto layout through flex classes, align, resize and comments. It has no insert tools: you can't draw a box or type a text layer. Each tool here writes plain TSX and Tailwind, so the code still reads like a developer wrote it.

**Insert tools** (most used first)

- ✅ Text (T): click inside a screen to add a `<p>` at the drop placement (Phase 10) and edit it in place; drag to set a width. The insert and the first edit are one undo step
- ❌ Frame (F, A): dropped. It duplicated New screen (`⌥N` and its presets), and Rectangle draws a box inside a screen. Sizes still snap to the 4 px spacing scale, and a drag across the parent writes `w-full`/`h-full`
- ✅ Rectangle (R) and ellipse (O): a `<div>` with `bg-muted` and the radius token; ellipse adds `rounded-full`
- ✅ Image (⇧⌘K): pick a file, it lands in `public/images/` (decision 0010) at the pointer, as `<img className="h-auto max-w-full">` with alt text from the file name. Off the screens it goes into the selected screen
- ✅ The tool bar shows the active tool; ↵ after insert selects the new element; Esc returns to Move (V). Each insert selects the new element and goes back to Move, as in Figma

**Inspect and measure**

- ✅ ⌥ + hover: red distance lines and values between the selection and the hovered element or its parent. Gaps when apart, edge to edge when one holds the other, dashed guides on a diagonal. Boxes come from the frame, with no RPC (`lib/measure.ts`, `measure-layer.tsx`)
- ✅ Layout grid per screen (⌃G): columns and margins drawn over the frame, stored in `rabisco.json` as the frame's `layoutGrid`. Add it and set count, gutter and margin in the inspector, with undo; ⌃G shows or hides every grid (`shared/layout-grid.ts`)
- ✅ ⇧2 zoom to selection (the selected element, else the screens, past 100% as in Figma), ⇧0 zoom to 100%

**Properties**

- ✅ Copy and paste properties (⌥⌘C / ⌥⌘V): copy an element's classes without its variants and children, paste onto one or many elements, one undo step. Copy keeps the base classes and leaves out `md:`/`hover:` variants; paste replaces each target's base classes and keeps its own variants
- ✅ Eyedropper (I) in the color field: pick a color from any frame, and snap it to the matching token when one exists. The frame reports the computed color under the pointer (text, SVG fill or the nearest background), so no pixels and no RPC; the value snaps to a theme token, a project color or the palette, else `[#hex]`, and keeps its alpha as `/NN`. One undo step (`lib/eyedropper.ts`, `runtime/pick-color.ts`)
- ✅ Auto layout panel the way Figma shows it: direction, wrap, a 3×3 alignment grid, gap and padding with "Auto" (`justify-between`), on top of the existing flex classes. The grid writes `justify-*`/`items-*` for the direction (reverse included), a direction change keeps the alignment where it shows, and a stretch survives a click on its row (`shared/tailwind/auto-layout.ts`)
- ✅ Hide (⇧⌘H) and lock (⇧⌘L) in Layers. Hide writes `hidden` in the TSX so exports match; lock is canvas state in `rabisco.json`. Layers rows show an eye and a lock to toggle them. Hide writes `hidden!` when a display class would win over `hidden`. A lock names its element by tree path and tag, follows it through edits in history, and is undoable. Locked elements and their children can't be picked, dragged or resized on the canvas; a click reaches the nearest unlocked ancestor
- ✅ Select matching (⌥⌘A): elements with the same component or the same classes, across the screen. Classes match in any order; an element without classes matches the same tag without classes

**Organize**

- ✅ Sections on the canvas (⇧S): a named, colored area that holds the screens whose center lies inside it and moves with them, stored in `rabisco.json` as `sections`. ⇧S wraps the selected screens or draws one; drag the name to move, double-click to rename, right-click for color and delete (the screens stay). The screens list groups by section (`shared/sections.ts`, `sections-layer.tsx`)
- ✅ Find and replace text across screens (⌘F on the canvas): JSX text and string literal children in the TSX, results by screen, click to select the element, replace one or all as one undo step. Text built by other expressions is skipped (`shared/jsx/find-text.ts`, `find-panel.tsx`)
- ✅ Version history panel: named checkpoints (⌥⌘S) and the AI changes in the session, each with a preview and Restore. Builds on undo history and git sync, with no new storage when git is set up. History tab in the left panel; a checkpoint is a commit with a `Rabisco-Checkpoint` trailer, or a session snapshot without git; Restore is one undo step and never rewrites git history ([0023](./decisions/0023-version-history.md))

**Prototype**

- ✅ Transitions on links (instant, dissolve, slide, push) as `data-link-transition`, played in play mode and the share viewer. Set in the inspector's Prototype section as one undo step. Back plays the way in reversed, and reduced motion fades instead of moving (`shared/prototype/transitions.ts`)
- ✅ Overlays: open a screen as a modal (`data-link-mode="overlay"`) or a sheet (`"sheet"`) over the current one, with "Open as" in the inspector. The backdrop, Esc or a `back` link closes it. Extends [0007](./decisions/0007-prototype-links-in-source.md) in [0022](./decisions/0022-link-transitions-and-overlays.md)

**Done when** a Figma user can make a screen, add text, a box and an image, measure spacing with ⌥ and organize screens into sections, with no prompt and no README.

---

## Phase 18: Verify in the app ✅

_Principle: UX first (no dead ends)_

Phases 1–17 were checked mostly in Chrome and unit tests. This phase runs every open check in the packaged app (WKWebView) and with real providers, in one pass.

**Real providers**

- ✅ The same prompt with Claude Code and Antigravity CLI: screens, `context` and `theme` tasks, variations (parallel CLI runs, rate limits), Mix, point and prompt, and component and custom token reuse. Fixed: the review note showed an agent's opening line ("looking at the screenshots:"). Fixed: the review of a point-and-prompt edit changed lines outside the focus, and no note said so. The review and repair runs now keep the focus, and the note covers their changes too ([LIT-86](/LIT/issues/LIT-86)). Fixed: a create run that ended with no screens counted as done and replied "Done.". It is now an error with a retry, and it names any actions Rabisco skipped ([LIT-87](/LIT/issues/LIT-87))
- ✅ Antigravity CLI replaces Gemini CLI ([decision 0032](./decisions/0032-antigravity-cli-replaces-gemini-cli.md)); its event mapping is built from a real `agy` 1.3.3 run
- ✅ Run the generation eval with real providers and keep the first report as the baseline (`bench/gen`). Claude Code (Opus): 12/12 briefs, reports in [LIT-11](/LIT/issues/LIT-11). Bug fixed: `hutch run bench:gen` ran the eval on Cottontail, where `playwright-core` failed to load. It now runs with real Bun ([LIT-88](/LIT/issues/LIT-88))
- ✅ Compare the eval before and after the Phase 16 prompt rules with the same provider. Baseline in `bench/gen/baseline.json`; with the rules, layout warnings drop from 28 to 16 and contrast findings from 29 to 18. Results in [LIT-12](/LIT/issues/LIT-12)

**Checks in WKWebView**

- ✅ Context import (folder picker, replace dialog), and changed DESIGN.md tokens re-theme open frames; paste in the context editor. Fixed: a file over 200 KB now gets its own message instead of "No PRODUCT.md or DESIGN.md", and the toast lists every folder searched ([LIT-71](/LIT/issues/LIT-71))
- ✅ PNG, SVG and PDF export; the Share popover (clipboard, open link); the share link from another device. The link serves the viewer on the Wi-Fi or Ethernet address and skips VPN and VM bridge addresses ([LIT-72](/LIT/issues/LIT-72)). Fixed: exports draw inset shadows and rings, and join adjacent text runs with tabular numbers ([LIT-83](/LIT/issues/LIT-83))
- ✅ Frames: the swap between a live frame and its snapshot, observer pausing offscreen, lazy covers on Home, `--zoom` counter-scaling of labels, outlines and link arrows. Fixed: the gap between a screen and its name grew with zoom (0.4 px at 10%, 16 px at 400%) and now stays 4 px. Broken links draw dashed in WKWebView ([LIT-70](/LIT/issues/LIT-70)). Home covers load one screen height ahead of the scroll area and show as snapshots, not live frames ([LIT-69](/LIT/issues/LIT-69)). Screen names, size badges, outline labels and link pills were pixelated at 300–400% and now draw in an unscaled layer above the canvas ([LIT-81](/LIT/issues/LIT-81)). At low zoom a screen's name hides when it would run into the screen above or a section's name, as in Figma ([LIT-82](/LIT/issues/LIT-82)). Outlines, selection rings, handles, guides and the marquee were soft at 300–400% and now draw in that layer too, snapped to device pixels ([LIT-134](/LIT/issues/LIT-134))
- ✅ Drop preview: the line, label and empty drop zone, "Can't drop here" on a broken screen, Esc mid-drag, a button dropped between two specific cards. Fixed: a drop between inline children on one line, in a `grid-auto-flow: column` grid or in a wrapping flex column landed first or last, and `display: contents` wrappers were skipped ([LIT-68](/LIT/issues/LIT-68)). The dragged element's label no longer sits under the drop container's label ([LIT-82](/LIT/issues/LIT-82)). Bug: [LIT-67](/LIT/issues/LIT-67)
- ✅ Context menus: the element menu after the async hit-test, focus after Rename, Ask AI and Make component from a menu, the clipboard prompt on ⌘V, ⌘R doesn't reload. Bugs: ⌘V showed the Paste callout (fixed, [LIT-64](/LIT/issues/LIT-64)), [LIT-65](/LIT/issues/LIT-65), [LIT-66](/LIT/issues/LIT-66)
- ✅ Element editing: drag, resize, padding and gap handles, ⇧-click multi-select, Layers hover sync, Tab between siblings, ⌘C/⌘V of elements, picked images on the canvas. Fixed: stale handles stayed on the canvas after a ⇧-click removal
- ✅ Chat: the `/` menu's keys, ⇧⌘O from the composer, deleting a chat to the Trash, a real Claude Code command run. Fixed: the `/` menu didn't open again after Esc, `/play` left the keys in the composer, Play's controls sat under the traffic lights
- ✅ Tokens: adding a token restarts the compiler and re-styles open frames; the token editor's Enter, Esc and blur
- ✅ uai blocks: chat cards and popovers in a narrow panel, blocks under a DESIGN.md theme and in dark mode, snapshots that catch entry animations half-drawn. Fixed: the panel overflowed at its minimum width (now 328 px), the chat didn't scroll to a new plan card. Snapshots now keep the step indicator's inset track ([LIT-83](/LIT/issues/LIT-83))

**Git and share**

- ✅ Git sync against GitHub over HTTPS and SSH: first push with upstream, a remote commit rebased under a local one, then pushed. A missing repository gives a readable error
- ✅ The share viewer in Safari: sidebar, in-screen links and Back. Fixed: lucide icons were blank in the share link and the website export, because their scripts weren't shipped

**Performance targets** (packaged app, 30-screen project)

- ✅ Pan and zoom hold 60 fps with no editor render per event (p95 18 ms). The marquee on 33 screens now holds 60 fps (was 34–45). Pinch zoom below 25% draws the snapshot frames on one canvas and holds 60 fps (p95 18 ms, was 23–31) ([LIT-90](/LIT/issues/LIT-90))
- ✅ Dragging a frame or a pin holds 60 fps (p95 18–19 ms) and is one history commit
- ✅ A keystroke in the code view or a style field shows in the frame within 50 ms (median 26–28 ms, p95 37–46 ms). Fixed: frames that didn't change got new CSS in the same task as the edited frame, which held a new class back to 100–125 ms. A keystroke that adds a new class replaced the frame's whole stylesheet and took 70–90 ms. The frame now gets only the new rules, and the whole sheet once the CSS is idle for 2 s: median 38 ms, was 89 ms ([LIT-91](/LIT/issues/LIT-91))
- ✅ Opening a project shows the first frames within 500 ms (270–380 ms at fit, about 200 ms live at 100%), with one Tailwind build

**Done when** every check above passes, or has a bug filed in a later phase.

---

## Phase 19: Never lose work ✅

_Principle: UX first (everything is undoable)_

Some failures today lose work or hide it. Fix them before adding more surface.

- ✅ Keep version history and undo across sessions without git. History is saved in app data, debounced, and files changed while the project was closed are folded in ([0024](./decisions/0024-history-in-app-data.md))
- ✅ Store API keys on Windows (Credential Manager, through PowerShell with the key on stdin). Onboarding and Settings say when keys can't be stored
- ✅ Surface the failures that empty `catch {}` blocks hide: context import, project folder writes (a failed write is now retried), git status, auto polish, plan mode, the share button
- ✅ Stop shows the stopped status, not a "Stopped" chat message
- ✅ Watch `rabisco.json`, so a `git pull` run outside Rabisco shows the new layout without reopening. The change is folded into undo history
- ✅ Autosave the composer draft per project and chat (text only)
- ✅ Recover after a crash: reopen the last project, the open chat and the canvas viewport. Back to home clears it
- ✅ A project backup before a migration or a reload from disk that clears history (app data, 10 per project, Show from the toast)
- ✅ Check it in the packaged app on macOS: reopen after a quit, a window close and a forced kill, undo after reopen, a `git pull` with the project open, and a failed folder write. Quitting or closing the window now writes pending edits and undo history first, and the save error stays up with Retry
- ✅ When `rabisco.json` changed while the project was closed, rebase history with `rebaseCanvas` instead of starting it again. History starts again, with a backup, only when the rebase can't reproduce the folder's canvas ([0033](./decisions/0033-rebase-saved-history-on-canvas-changes.md))
- ✅ Moving or renaming a project folder keeps its history and backups. History keeps `public/` images (undo brings back a deleted moodboard image), and backups include images and chats ([0034](./decisions/0034-history-follows-moves-and-keeps-images.md))

**Done when** closing the app, a crash or a failed sync never loses a change the user made.

---

## Phase 20: Editing leftovers ✅

_Principle: Direct manipulation over prompts_

Open items from phases 6, 9, 11 and 12.

- ✅ Move an element to another screen by dragging. Both screens change in one undo step, and imports move with the element. An element that uses its old screen's local state or variables won't compile in the new one
- ✅ Resize and padding handles follow the State switch, and work with several elements selected
- ✅ Arrow keys follow the parent's main axis: ←/→ in a row, ↑/↓ in a column, and by row in a grid
- ✅ Renaming a screen's route rewrites `href="#/…"` as it does `data-link-to` (`retargetLinks`). Nothing renames screen files yet, so nothing calls it
- ✅ Rewrite images in `srcSet`, `<source>` and `new Image()` to project images. `setAttribute("src", …)` is still not rewritten
- ✅ "Link to" on the element menu (links are per element, [0007](./decisions/0007-prototype-links-in-source.md))
- ✅ Prototype connectors start at the linked element, not at the frame edge
- ✅ A ⌘-click or double-click on a frame that is not live selects the element once its iframe loads; "Send to chat" on such a frame targets the element, not the whole screen
- ✅ `const Foo = () =>` components keep their state on edit, as `function` components do. `memo` and `forwardRef` components still remount
- ✅ Point and prompt with several elements selected sends all of them, not only the first ([0025](./decisions/0025-focus-on-several-elements.md))
- ✅ Align and distribute elements inside a screen, not only screens. Aligning some children along a row or column, and distributing only some of them, are refused
- ✅ Check it in the packaged app: dragging an element between screens, handles in a state and with several elements, arrow keys in a row, column and grid, element align and distribute, the Link to menu, connectors from elements, a ⌘-click on a snapshot frame, and a multi-element point and prompt. Fixed: ⌃⌥V ran Paste properties (⌥⌘V) instead of Distribute vertically. Bugs: after a class edit, clicks on later elements select nothing ([LIT-93](/LIT/issues/LIT-93)); a real right-click on a screen opened WebKit's menu instead of the element menu (fixed, [LIT-94](/LIT/issues/LIT-94)); aligning absolute children does nothing ([LIT-95](/LIT/issues/LIT-95)); [LIT-96](/LIT/issues/LIT-96). Fixed in the selection chrome: a ⇧-click on the size chip adds the element under it instead of opening the menu, a child that a flex parent stretches reads "Fill", hover outlines have no label while several elements are selected, and the element menu fits in the window (the copy and paste variants are in a "Copy/Paste as" submenu) ([LIT-97](/LIT/issues/LIT-97))
- ✅ Align and distribute buttons in the element inspector. They run the same actions as the keys and menus, and a refused one is off with the reason in its tooltip
- ✅ Absolutely positioned elements align and distribute, as in Figma. The editor measures each one in its containing block and writes `left-*`/`top-*` at the breakpoint that places it. It drops the opposing `right-*`/`bottom-*` and `translate` centering. One element aligns to its containing block. Several align to their bounds ([LIT-136](/LIT/issues/LIT-136))

**Done when** a user can build a simple card from components with the mouse only, and the TSX reads like a developer wrote it.

---

## Phase 21: Start from something that exists ✅

_Principles: UX first · Screens are React_

Every competitor starts from a reference: a screenshot, a live site or a Figma file. Rabisco can attach images to a prompt ([0011](./decisions/0011-image-attachments-reach-every-provider.md)), but it can't turn them into an editable screen on purpose.

- ✅ "Recreate from screenshot": drop an image on the canvas, get a screen that matches it, then compare the two side by side with an overlay and a difference score ([0036](./decisions/0036-recreate-from-screenshot.md)). The selected image offers "Recreate from screenshot", which runs a create with the image, on the device its shape suggests, and places the screen beside it as one undo step. The review compares the screen with the screenshot. "Compare" shows them side by side, as an overlay or as a difference, with the share of pixels that differ
- ✅ Numbered image references in the composer, so a prompt can say "the layout from image 2"
- ✅ Paste HTML with inline styles, or a page section, and get TSX with Tailwind classes ([0035](./decisions/0035-imports-become-one-captured-tree.md)). ⌘V on the canvas renders the HTML in a sandboxed frame, reads its computed styles and writes a new screen as one undo step. Colors, sizes and radii snap to the project's tokens first, then the Tailwind scale
- ✅ Capture a live URL and get a screen and tokens in its style ([0035](./decisions/0035-imports-become-one-captured-tree.md)). "Import from HTML or URL…" in the canvas menu loads the page in a hidden, sandboxed window with no RPC and its own storage, waits for it to settle and reads the DOM and styles. Its images are copied into `public/images/imported/`. "Use the site's theme" writes its tokens to DESIGN.md as a second undo step, and the screen already uses them
- ✅ Paste from Figma: frames, text, images and auto layout as TSX, with Figma variables as tokens ([0035](./decisions/0035-imports-become-one-captured-tree.md)). ⌘V reads the `fig-kiwi` buffer in a Web Worker and makes one screen per frame, with auto layout as flex. Image fills become placeholders. Variables bound to fills, strokes, radii, gaps and padding become token classes, and the missing ones go into DESIGN.md as a second undo step
- ✅ Attach a PRD or any Markdown file, and plan every screen from it ([0037](./decisions/0037-documents-plan-every-screen.md)). The composer takes `.md` and `.txt` files by the add menu, paste or drop. Their text goes into the prompt for every provider, and an attached document always plans first: the plan card lists every screen it describes, up to 12, for review before any is written
- ✅ Moodboard: images placed on the canvas next to the screens are sent as references, as MagicPath does
- ✅ Import a Design.md or brand kit from a URL, and pull colors from an uploaded logo. DESIGN.md actions: "Import from a URL…" reads a Design.md, a CSS theme or a JSON token file (GitHub links work); "Colors from a logo…" sets primary, its foreground, ring and charts. Each is one undo step that re-themes the screens

**Done when** a user can drop a screenshot of an existing app and get an editable screen in its style on the first try.

---

## Phase 22: Rabisco for coding agents ✅

_Principles: Bring your own AI · Context is a file_

MagicPath, Banani and Paper all let Claude Code, Codex and Cursor work on the canvas. Screens are files on disk, so an agent can already edit them, but it can't see the selection, take a screenshot or make a change that goes through history.

- ✅ A local MCP server in the main process, off by default, with a token per session. Settings has "Let coding agents use Rabisco" and "Reset access"; clients find the port and token in `mcp.json` in app data ([0030](./decisions/0030-local-mcp-server-for-coding-agents.md))
- ✅ Read tools: the project, the screens, the selection, the element tree, a screenshot of a screen or element, DESIGN.md tokens, the component catalog, open comments
- ✅ Write tools: `create_screen`, `edit_screen` (search/replace blocks or whole TSX), `write_component`, `set_design_tokens`, `add_comment`. Each call is one undo step in history. A write that doesn't compile, doesn't match, touches a locked element or lands during a generation changes nothing and says why
- ✅ An "agent is editing" marker on the frames an agent touches, and a log of agent changes in the History panel. Each write shows "<agent> is editing" on the screens it changed for 15 seconds, and lands in History with the agent's name
- ✅ One-click setup for Claude Code, Codex, Cursor, VS Code and Claude Desktop, from Settings → Agents. It writes a `rabisco` server that launches the stdio bridge into each client's config (through `claude mcp add-json` for Claude Code), never a port or a token, and shows which clients are set up and which connected. The bridge itself ships with the `rabisco` CLI
- ✅ A `rabisco` CLI: `open`, `check`, `screenshot`, `export` and `mcp` (the stdio bridge). It ships in the app bundle and runs on the app's own runtime; `rabisco open` works with the MCP server off
- ✅ "Send to agent": copy a screen or selection with its code, tokens and screenshot as context for a coding agent. "Copy for agent" (`⌥⇧⌘C`, in the screen and element menus) copies Markdown with each selected screen's TSX, the selected elements' lines, the components the screens import, the DESIGN.md tokens as CSS, and the path of a PNG screenshot it saves in the system's temp folder
- ✅ Sync a screen into an existing app repository: write it as a component at a path the user picks, with its imports. "Sync to repository…" (`⌥⇧⌘S`) writes the screen and the components it imports, points relative imports at their new places and uses the repository's shadcn aliases from `components.json`. It shows which files it replaces and which shadcn primitives and packages the repository still needs, and it remembers the repository and paths per screen

**Done when** Claude Code can read the selected screen, change it, and the user can undo that change in Rabisco.

---

## Early decisions

The open questions from the first draft, as they were settled. The full list is in [docs/decisions](./decisions/README.md):

- **Where to compile TSX:** in the webview, with Sucrase. The RPC round trip (~17.5 ms) costs far more than compiling (~0.3 ms) ([0001](./decisions/0001-compile-tsx-in-the-webview.md)).
- **Tailwind in the sandbox:** one incremental compiler in the host, with the CSS shared by all frames. It rebuilds only when new classes appear ([0002](./decisions/0002-incremental-tailwind-in-the-host.md)).
- **Agent or one-shot generation:** both. Every provider writes files through one event contract ([0003](./decisions/0003-ai-provider-contract.md)).
- **Alternates storage:** files, `screens/<name>.alt-N.tsx` ([0004](./decisions/0004-alternates-are-files.md)).
- **Component structure:** read from the TSX source with Sucrase's tokenizer, not from the rendered DOM ([0006](./decisions/0006-components-from-source.md)).
- **Prototype links:** a `data-link-to` attribute in the TSX, so links survive edits and export ([0007](./decisions/0007-prototype-links-in-source.md)).
- **Share and git:** a read-only link is a static viewer that the main process serves on the local network, with no account or server. Git sync runs the system `git` CLI, scoped to the project folder, and never force-pushes ([0008](./decisions/0008-share-link-and-git-sync.md)).
