# Rabisco roadmap

This roadmap lists the work that is still open. Phases are in priority order, and each one delivers something usable on its own. The [principles](./PRINCIPLES.md) explain why it is built this way. Finished work from phases 0–17 is in the [archive](./ROADMAP-ARCHIVE.md); when a phase here is done, move it there.

Status: 🚧 in progress · ⬜ not started · 🧭 needs a decision record first

The competitor notes come from a review of MagicPath, Banani and Paper in October 2026.

---

## Phase 18: Verify in the app 🚧

_Principle: UX first (no dead ends)_

Phases 1–17 were checked mostly in Chrome and unit tests. This phase runs every open check in the packaged app (WKWebView) and with real providers, in one pass.

**Real providers**

- ✅ The same prompt with Claude Code and Antigravity CLI: screens, `context` and `theme` tasks, variations (parallel CLI runs, rate limits), Mix, point and prompt, and component and custom token reuse. Fixed: the review note showed an agent's opening line ("looking at the screenshots:"). Bugs: [LIT-86](/LIT/issues/LIT-86) (the review edits outside the focus, unreported), [LIT-87](/LIT/issues/LIT-87) (Antigravity runs that end with no screens)
- ✅ Antigravity CLI replaces Gemini CLI ([decision 0032](./decisions/0032-antigravity-cli-replaces-gemini-cli.md)); its event mapping is built from a real `agy` 1.3.3 run
- ⬜ The same checks with an API key and Ollama, and a real Codex run to check its event mapping
- ✅ Run the generation eval with real providers and keep the first report as the baseline (`bench/gen`). Claude Code (Opus): 12/12 briefs, reports in [LIT-11](/LIT/issues/LIT-11). Bug: [LIT-88](/LIT/issues/LIT-88)
- ✅ Compare the eval before and after the Phase 16 prompt rules with the same provider. Baseline in `bench/gen/baseline.json`; with the rules, layout warnings drop from 28 to 16 and contrast findings from 29 to 18. Results in [LIT-12](/LIT/issues/LIT-12)

**Checks in WKWebView**

- ✅ Context import (folder picker, replace dialog), and changed DESIGN.md tokens re-theme open frames; paste in the context editor. Bug: [LIT-71](/LIT/issues/LIT-71)
- ✅ PNG, SVG and PDF export; the Share popover (clipboard, open link); the share link from another device. The link serves the viewer on the Wi-Fi or Ethernet address and skips VPN and VM bridge addresses ([LIT-72](/LIT/issues/LIT-72)); fidelity bugs in [LIT-83](/LIT/issues/LIT-83)
- ✅ Frames: the swap between a live frame and its snapshot, observer pausing offscreen, lazy covers on Home, `--zoom` counter-scaling of labels, outlines and link arrows. Bugs: [LIT-69](/LIT/issues/LIT-69), [LIT-70](/LIT/issues/LIT-70), [LIT-81](/LIT/issues/LIT-81), [LIT-82](/LIT/issues/LIT-82)
- ✅ Drop preview: the line, label and empty drop zone, "Can't drop here" on a broken screen, Esc mid-drag, a button dropped between two specific cards. Bugs: [LIT-67](/LIT/issues/LIT-67), [LIT-68](/LIT/issues/LIT-68), [LIT-82](/LIT/issues/LIT-82)
- ✅ Context menus: the element menu after the async hit-test, focus after Rename, Ask AI and Make component from a menu, the clipboard prompt on ⌘V, ⌘R doesn't reload. Bugs: ⌘V showed the Paste callout (fixed, [LIT-64](/LIT/issues/LIT-64)), [LIT-65](/LIT/issues/LIT-65), [LIT-66](/LIT/issues/LIT-66)
- ✅ Element editing: drag, resize, padding and gap handles, ⇧-click multi-select, Layers hover sync, Tab between siblings, ⌘C/⌘V of elements, picked images on the canvas. Fixed: stale handles stayed on the canvas after a ⇧-click removal
- ✅ Chat: the `/` menu's keys, ⇧⌘O from the composer, deleting a chat to the Trash, a real Claude Code command run. Fixed: the `/` menu didn't open again after Esc, `/play` left the keys in the composer, Play's controls sat under the traffic lights
- ✅ Tokens: adding a token restarts the compiler and re-styles open frames; the token editor's Enter, Esc and blur
- ✅ uai blocks: chat cards and popovers in a narrow panel, blocks under a DESIGN.md theme and in dark mode, snapshots that catch entry animations half-drawn. Fixed: the panel overflowed at its minimum width (now 328 px), the chat didn't scroll to a new plan card. Snapshots drop the step indicator's inset track: [LIT-83](/LIT/issues/LIT-83)

**Git and share**

- ✅ Git sync against GitHub over HTTPS and SSH: first push with upstream, a remote commit rebased under a local one, then pushed. A missing repository gives a readable error
- ✅ The share viewer in Safari: sidebar, in-screen links and Back. Fixed: lucide icons were blank in the share link and the website export, because their scripts weren't shipped

**Performance targets** (packaged app, 30-screen project)

- ✅ Pan and zoom hold 60 fps with no editor render per event (p95 18 ms). The marquee on 33 screens now holds 60 fps (was 34–45). Bug: pinch zoom below 20% drops frames, p95 23–31 ms ([LIT-90](/LIT/issues/LIT-90))
- ✅ Dragging a frame or a pin holds 60 fps (p95 18–19 ms) and is one history commit
- ✅ A keystroke in the code view or a style field shows in the frame within 50 ms (median 26–28 ms, p95 37–46 ms). Fixed: frames that didn't change got new CSS in the same task as the edited frame, which held a new class back to 100–125 ms. Bug: a keystroke that adds a new class still takes 70–90 ms ([LIT-91](/LIT/issues/LIT-91))
- ✅ Opening a project shows the first frames within 500 ms (270–380 ms at fit, about 200 ms live at 100%), with one Tailwind build

**Done when** every check above passes, or has a bug filed in a later phase.

---

## Phase 19: Never lose work 🚧

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
- ⬜ Check the Windows key store on a Windows machine (deferred until a Windows machine is available)
- ✅ When `rabisco.json` changed while the project was closed, rebase history with `rebaseCanvas` instead of starting it again. History starts again, with a backup, only when the rebase can't reproduce the folder's canvas ([0033](./decisions/0033-rebase-saved-history-on-canvas-changes.md))
- ✅ Moving or renaming a project folder keeps its history and backups. History keeps `public/` images (undo brings back a deleted moodboard image), and backups include images and chats ([0034](./decisions/0034-history-follows-moves-and-keeps-images.md))

**Done when** closing the app, a crash or a failed sync never loses a change the user made.

---

## Phase 20: Editing leftovers 🚧

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
- ✅ Check it in the packaged app: dragging an element between screens, handles in a state and with several elements, arrow keys in a row, column and grid, element align and distribute, the Link to menu, connectors from elements, a ⌘-click on a snapshot frame, and a multi-element point and prompt. Fixed: ⌃⌥V ran Paste properties (⌥⌘V) instead of Distribute vertically. Bugs: after a class edit, clicks on later elements select nothing ([LIT-93](/LIT/issues/LIT-93)); a real right-click on a screen opened WebKit's menu instead of the element menu (fixed, [LIT-94](/LIT/issues/LIT-94)); aligning absolute children does nothing ([LIT-95](/LIT/issues/LIT-95)); [LIT-96](/LIT/issues/LIT-96), [LIT-97](/LIT/issues/LIT-97)
- ✅ Align and distribute buttons in the element inspector. They run the same actions as the keys and menus, and a refused one is off with the reason in its tooltip

**Done when** a user can build a simple card from components with the mouse only, and the TSX reads like a developer wrote it.

---

## Phase 22: Rabisco for coding agents ⬜ 🧭

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

## Phase 21: Start from something that exists ⬜

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

## Phase 23: Share beyond the local network ⬜ 🧭

_Principle: UX first (no dead ends)_

The share link works only on the local network ([0008](./decisions/0008-share-link-and-git-sync.md)). Competitors share a public link that needs no account. A new decision must pick how, and keep the app working with no account.

- ⬜ Publish "Export as website" to a static host the user owns: GitHub Pages, Vercel, Netlify or Cloudflare Pages, with their CLI or token
- ⬜ A QR code for the LAN link, to open a prototype on a phone
- ⬜ Comments from viewers on a shared link, collected back into the project
- ⬜ A password or an expiry on a published link
- ⬜ An inspect mode in the viewer: element size, spacing, colors as tokens, and the TSX of a selected element
- ⬜ Record a prototype walkthrough as a video or GIF

**Done when** a user can send a link that a stakeholder opens on their phone, anywhere.

---

## Phase 24: Handoff and export ⬜

_Principle: Screens are React (what you see is what you ship)_

- ⬜ Copy to Figma: screens as Figma layers with auto layout, text and images, through the clipboard 🧭
- ⬜ Export plain HTML and CSS for one screen
- ⬜ Export to Next.js and React Router projects, next to the Vite project
- ⬜ Export a component library: every project component with a preview page
- ⬜ Export tokens as `tokens.json` (DTCG), `tokens.css` and a Tailwind theme
- ⬜ Copy an element as code, as PNG and as SVG from its menu
- ⬜ Batch export at 1x, 2x and 3x, with names from the screens
- ⬜ Dev handoff page in the export: every screen, its components and tokens

**Done when** a developer can take a project into their app, and a designer can take it into Figma, with no manual fixes.

---

## Phase 25: Design system ⬜ 🧭

_Principles: Component based by default · Context is a file_

Open items from phase 14, plus the gaps that make design system work hard.

**Tokens**

- ⬜ A design system view: tokens by category, rename with usages rewritten, delete with a usage count, shadows and font weights
- ⬜ Find raw values that match a token ("12 raw colors in 4 screens") and replace them in one step; detach a token back to a value
- ⬜ Import tokens from DTCG or Figma Variables JSON, pasted shadcn CSS or a tweakcn link
- ⬜ Text styles: named type tokens applied as one class, shown in the inspector

**Themed sections** ([0028](./decisions/0028-themed-sections.md) 🧭)

Figma sets a variable mode on a section, and every frame inside follows it. Rabisco sections can do the same with token modes, and can also try out token changes before they reach the project.

- ⬜ Dark mode on frames: a section or a screen set to Dark adds `.dark` to the frame root, so the `### Dark` tokens in DESIGN.md show. Today no frame ever renders dark
- ⬜ More modes than light and dark in DESIGN.md (brand, density, contrast), each a group of named options with its own token values
- ⬜ A Theme row in the section inspector and menu: pick an option for each mode group. Screens inside follow it at once, and a screen dragged in or out re-themes on drop
- ⬜ Nested sections inherit: the innermost section that sets a group wins, and groups it leaves unset come from the section around it, then the project default
- ⬜ A screen can set its own mode from its menu, which wins over its section
- ⬜ Token overrides on a section: change a token for that section only, to try a new primary color or radius next to the current one. "Save as mode" writes it to DESIGN.md as a new option; "Apply to project" makes it the project value; "Discard" drops it
- ⬜ "Duplicate with mode": copy a section and its screens with another mode, to compare them side by side 🧭
- ⬜ Play mode, the share viewer, image export, snapshots and the code export use each screen's resolved mode. The export sets it on each screen's route, so a screen exports the way it looks on the canvas
- ⬜ Generations and point and prompt see the screen's mode and its tokens, and the dark mode pass in Phase 27 checks screens in a Dark section

**Components**

- ⬜ A component page with every variant and state side by side
- ⬜ Edit variants and slots visually: add a variant, set its classes, see every usage
- ⬜ Swap a component for another in place, keeping matching props
- ⬜ Shared libraries across projects: a folder of components and tokens that projects import
- ⬜ Starter kits beyond shadcn: more uai blocks, icon packs and design systems from known products

**Assets**

- ⬜ An assets panel: project images, icons and fonts, with usage counts
- ⬜ Upload and use custom fonts, embedded in exports
- ⬜ AI image generation for real photos and illustrations, through the provider layer, replacing placeholders on request

**Done when** a team can keep one design system across projects, and every new screen uses it.

---

## Phase 26: Components and motion ⬜ 🧭

_Principles: Component based by default · Direct manipulation over prompts · Screens are React_

A component can be edited only from the Components tab or the code view, a usage can't differ from it except through its props, links are made one at a time in the inspector, and screens have no motion beyond link transitions. Figma users expect a main component with instances, links drawn on the canvas, and animation presets.

**Main component and instances** ([0026](./decisions/0026-component-overrides-in-source.md) 🧭)

- ⬜ Edit a component from any usage on the canvas: step inside the usage, edit its elements in place, and see every other usage update. A bar names the component and its usage count, and Esc steps out
- ⬜ "Go to component" from a usage's menu: select the component in the Components tab and open its file
- ⬜ Overrides on one usage: text, string props and classes changed on that usage only, written at the call site. The inspector marks overridden fields
- ⬜ "Reset overrides" on a usage, and "Apply to component" to move a usage's overrides into the component for every usage
- ⬜ "Detach" (⌥⌘B) inlines a usage as plain JSX, with its props filled in
- ⬜ Layers and the inspector show usages as instances, with the component's name and a link to it

**Prototype links on the canvas**

- ⬜ Drag from a selected element's link handle to a screen to link it, as in Figma. Drop on empty canvas to cancel
- ⬜ Click a connector to select the link: edit its transition and mode in a popover, Delete removes it
- ⬜ Duration and easing for a transition, with defaults from motion tokens 🧭 (extends [0022](./decisions/0022-link-transitions-and-overlays.md))
- ⬜ Triggers other than a click: hover, press, after a delay, and a key 🧭
- ⬜ Actions other than navigate: scroll to an element, open a URL, and switch a component's variant 🧭

**Motion** ([0027](./decisions/0027-motion-in-source.md) 🧭)

- ⬜ A motion catalog in the left panel: hover, press, appear, loop and exit presets, each with a live preview
- ⬜ Drag a preset onto an element, or apply it from the element menu, as one undo step
- ⬜ A Motion section in the inspector: the element's presets, with duration, delay and easing, and a replay button
- ⬜ Motion tokens in DESIGN.md (durations and easings), shared by presets, link transitions and generations
- ⬜ Generations use the presets and tokens, and point and prompt can add motion ("a subtle entrance for this list")
- ⬜ Snapshots, exports and reduced motion: frames snapshot at the end state, the export keeps the classes, and reduced motion turns movement into a fade

**Done when** a user can change a button inside one card on the canvas and see every card update, override the label of one card, link three screens by dragging, and add a hover and an appear animation, with no prompt and no code view.

---

## Phase 27: Generation, next steps ⬜

_Principles: UX first (a bad generation costs one keystroke) · Variations, not verdicts_

- ⬜ Next screen from an element: click a button, describe where it goes, and get the linked screen in the same style (Banani's favorite flow)
- ⬜ Project-wide edits: "make every heading bolder" across screens, as one undo step with a summary by screen
- ⬜ Responsive variants: generate the tablet or desktop version of a mobile screen, or the other way, linked as one screen
- ⬜ States on request: empty, loading, error and filled versions of a screen, as alternates
- ⬜ A dark mode pass that checks every screen against the dark tokens
- ⬜ Stop one screen in a parallel run without stopping the others; retry one failed screen
- ⬜ Show tokens and cost per generation in the chat, and a running total per project
- ⬜ Queue a prompt while a generation runs, instead of disabling the composer
- ⬜ Realistic content: copy and data from PRODUCT.md, with a "Shuffle content" action
- ⬜ An accessibility check next to "Check design": labels, focus order, tap targets and landmarks
- ⬜ Cross-screen consistency check: the same component, spacing and nav across screens
- ⬜ A prompt library: save and reuse prompts per project, and see past prompts per screen
- ⬜ Model presets per task in Settings (create, edit, review), on top of the fast model

**Done when** the eval baseline from Phase 18 improves, and most follow-up work on a generated flow needs one prompt or none.

---

## Phase 28: Canvas and editing, next steps ⬜

_Principles: Direct manipulation over prompts · Keyboard first (Figma conventions)_

- ⬜ A grid layout panel: columns, rows, gaps and spans, written as `grid-*` classes
- ⬜ Fill editor with gradients, image fills and opacity; shadow and blur editors with presets
- ⬜ Rich text: bold, italic and links inside a text block, written as `<strong>`, `<em>` and `<a>`
- ⬜ Rulers and guides on frames (⇧R)
- ⬜ Sticky notes and arrows on the canvas, for annotations that aren't screens
- ⬜ Flow view: screens laid out by their prototype links, with one click
- ⬜ Tidy up: arrange selected screens in a grid
- ⬜ Pages in a project, each with its own canvas
- ⬜ A vector pen tool, written as inline SVG
- ⬜ Constraints for absolutely positioned elements, as `inset-*` classes

**Done when** a Figma user can lay out a dashboard with grids, gradients and annotations, with no prompt.

---

## Phase 29: Prototyping, next steps ⬜

_Principle: Screens are React_

Screens are real React, so prototypes can do more than link screens.

- ⬜ Interactive state: tabs, toggles and forms that work in play mode, written as React state
- ⬜ Scroll behavior: fixed headers and tab bars, and scroll to an anchor
- ⬜ Device frames in play mode and the share viewer
- ⬜ Several starting points (flows), each with a name, in play mode and the share viewer
- ⬜ Smart transitions between matching elements on two screens

**Done when** a usability test can run on a shared prototype with no extra tool.

---

## Phase 30: App and platform ⬜

_Principle: UX first_

- ⬜ App icon, code signing and notarization on macOS
- ⬜ Auto-updates and release channels (Electrobun `Updater`)
- ⬜ Windows and Linux builds, tested end to end
- ⬜ General settings: default projects folder, default device and style, updates, opt-in crash reports
- ⬜ Rename, duplicate and export a project from Home
- ⬜ Project templates on Home: a SaaS dashboard, a mobile app, a landing page
- ⬜ Empty states in the History, Screens and Layers panels
- ⬜ Split `canvas.tsx` and `editor.tsx` (2,700 and 2,400 lines)
- ⬜ An accessible editor: keyboard focus through panels, screen reader labels, reduced motion
- ⬜ Localize the editor

**Done when** a user can download Rabisco, install it on any OS, and it updates itself.

---

## Later

- Real-time collaboration and comments with authors 🧭
- A plugin API for custom providers, exporters and tools 🧭
- A web version that opens shared projects in the browser
- Cloud sync of projects across machines, as an option next to git
- Design reviews: a review mode with approvals per screen
