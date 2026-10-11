# Rabisco roadmap

This roadmap lists the work that is still open. Phases are in priority order, and each one delivers something usable on its own. The [principles](./PRINCIPLES.md) explain why it is built this way. Finished work from phases 0–17 is in the [archive](./ROADMAP-ARCHIVE.md); when a phase here is done, move it there.

Status: 🚧 in progress · ⬜ not started · 🧭 needs a decision record first

The competitor notes come from a review of MagicPath, Banani and Paper in October 2026.

---

## Phase 18: Verify in the app 🚧

_Principle: UX first (no dead ends)_

Phases 1–17 were checked mostly in Chrome and unit tests. This phase runs every open check in the packaged app (WKWebView) and with real providers, in one pass.

**Real providers**

- ⬜ The same prompt with an API key, Claude Code and Ollama: screens, `context` and `theme` tasks, variations (parallel CLI runs, rate limits), Mix, point and prompt (how often the focus guard fires), and component and custom token reuse
- ⬜ A real Codex run to check its event mapping; Gemini CLI against its docs
- ⬜ Run the generation eval with real providers and keep the first report as the baseline (`bench/gen`)
- ⬜ Compare the eval before and after the Phase 16 prompt rules with the same provider

**Checks in WKWebView**

- 🚧 Context import (folder picker, replace dialog), and changed DESIGN.md tokens re-theme open frames. Recheck paste in the context editor
- ⬜ PNG, SVG and PDF export; the Share popover (clipboard, open link); the share link from another device
- ⬜ Frames: the swap between a live frame and its snapshot, observer pausing offscreen, lazy covers on Home, `--zoom` counter-scaling of labels, outlines and link arrows
- ⬜ Drop preview: the line, label and empty drop zone, "Can't drop here" on a broken screen, Esc mid-drag, a button dropped between two specific cards
- ⬜ Context menus: the element menu after the async hit-test, focus after Rename, Ask AI and Make component from a menu, the clipboard prompt on ⌘V, ⌘R doesn't reload
- ⬜ Element editing: drag, resize, padding and gap handles, ⇧-click multi-select, Layers hover sync, Tab between siblings, ⌘C/⌘V of elements, picked images on the canvas
- ⬜ Chat: the `/` menu's keys, ⇧⌘O from the composer, deleting a chat to the Trash, a real Claude Code command run
- ⬜ Tokens: adding a token restarts the compiler and re-styles open frames; the token editor's Enter, Esc and blur
- ⬜ uai blocks: chat cards and popovers in a narrow panel, blocks under a DESIGN.md theme and in dark mode, snapshots that catch entry animations half-drawn

**Git and share**

- ⬜ Git sync against GitHub over HTTPS and SSH
- ⬜ The share viewer in Safari

**Performance targets** (packaged app, 30-screen project)

- 🚧 Pan and zoom hold 60 fps with no editor render per event. A marquee on 33 screens ran at 34–45 fps before the selection fix; recheck
- ⬜ Dragging a frame or a pin holds 60 fps and is one history commit
- ⬜ A keystroke in the code view or a style field shows in the frame within 50 ms
- ⬜ Opening a project shows the first frames within 500 ms, with one Tailwind build

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
- ⬜ Check it in the packaged app: reopen after a quit and a forced kill, undo after reopen, a `git pull` with the project open, a failed folder write, and the Windows key store on a Windows machine
- ⬜ When `rabisco.json` changed while the project was closed, rebase history with `rebaseCanvas` instead of starting it again
- ⬜ History starts again when a project folder is moved or renamed; history and backups don't include `public/` images or chats

**Done when** closing the app, a crash or a failed sync never loses a change the user made.

---

## Phase 20: Editing leftovers ⬜

_Principle: Direct manipulation over prompts_

Open items from phases 6, 9, 11 and 12.

- ⬜ Move an element to another screen by dragging
- ⬜ Resize and padding handles follow the State switch, and work with several elements selected
- ⬜ Arrow keys follow the parent's main axis (↑/← always move earlier today)
- ⬜ Renaming a screen updates `href="#/…"` as it does `data-link-to`
- ⬜ Rewrite images in `srcSet`, `<source>` and `new Image()` to project images
- ⬜ "Link to" on the element menu (links are per element, [0007](./decisions/0007-prototype-links-in-source.md))
- ⬜ Prototype connectors start at the linked element, not at the frame edge
- ⬜ A ⌘-click or double-click on a frame that is not live selects the element once its iframe loads; "Send to chat" on such a frame targets the element, not the whole screen
- ⬜ `const Foo = () =>` components keep their state on edit, as `function` components do
- ⬜ Point and prompt with several elements selected sends all of them, not only the first
- ⬜ Align and distribute elements inside a screen, not only screens

**Done when** a user can build a simple card from components with the mouse only, and the TSX reads like a developer wrote it.

---

## Phase 21: Start from something that exists ⬜

_Principles: UX first · Screens are React_

Every competitor starts from a reference: a screenshot, a live site or a Figma file. Rabisco can attach images to a prompt ([0011](./decisions/0011-image-attachments-reach-every-provider.md)), but it can't turn them into an editable screen on purpose.

- ⬜ "Recreate from screenshot": drop an image on the canvas, get a screen that matches it, then compare the two side by side with an overlay and a difference score
- ⬜ Numbered image references in the composer, so a prompt can say "the layout from image 2"
- ⬜ Paste HTML with inline styles, or a page section, and get TSX with Tailwind classes 🧭
- ⬜ Capture a live URL: render it in a hidden frame, read the DOM and styles, write TSX and DESIGN.md tokens from it 🧭
- ⬜ Paste from Figma: frames, text, images and auto layout as TSX, with Figma variables as tokens 🧭
- ⬜ Attach a PRD or any Markdown file, and plan every screen from it
- ⬜ Moodboard: images placed on the canvas next to the screens are sent as references, as MagicPath does
- ⬜ Import a Design.md or brand kit from a URL, and pull colors from an uploaded logo

**Done when** a user can drop a screenshot of an existing app and get an editable screen in its style on the first try.

---

## Phase 22: Rabisco for coding agents ⬜ 🧭

_Principles: Bring your own AI · Context is a file_

MagicPath, Banani and Paper all let Claude Code, Codex and Cursor work on the canvas. Screens are files on disk, so an agent can already edit them, but it can't see the selection, take a screenshot or make a change that goes through history.

- ⬜ A local MCP server in the main process, off by default, with a token per session
- ⬜ Read tools: the project, the screens, the selection, the element tree, a screenshot of a screen or element, DESIGN.md tokens, the component catalog, open comments
- ⬜ Write tools: create and edit screens and components, set tokens, add comments. Each call is one undo step in history
- ⬜ An "agent is editing" marker on the frames an agent touches, and a log of agent changes in the History panel
- ⬜ One-click setup for Claude Code, Codex, Cursor, VS Code and Claude Desktop, from Settings
- ⬜ A `rabisco` CLI: open a project, export, run "Check design", take screenshots
- ⬜ "Send to agent": copy a screen or selection with its code, tokens and screenshot as context for a coding agent
- ⬜ Sync a screen into an existing app repository: write it as a component at a path the user picks, with its imports

**Done when** Claude Code can read the selected screen, change it, and the user can undo that change in Rabisco.

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

## Phase 25: Design system ⬜

_Principles: Component based by default · Context is a file_

Open items from phase 14, plus the gaps that make design system work hard.

**Tokens**

- ⬜ A design system view: tokens by category, rename with usages rewritten, delete with a usage count, shadows and font weights
- ⬜ Find raw values that match a token ("12 raw colors in 4 screens") and replace them in one step; detach a token back to a value
- ⬜ Import tokens from DTCG or Figma Variables JSON, pasted shadcn CSS or a tweakcn link
- ⬜ More modes than light and dark (brands, density, high contrast), with a preview switch on frames
- ⬜ Text styles: named type tokens applied as one class, shown in the inspector

**Components**

- ⬜ A component page with every variant and state side by side
- ⬜ Edit variants and slots visually: add a variant, set its classes, see every usage
- ⬜ Overrides on a usage, and "Detach" to inline a component
- ⬜ Swap a component for another in place, keeping matching props
- ⬜ Shared libraries across projects: a folder of components and tokens that projects import
- ⬜ Starter kits beyond shadcn: more uai blocks, icon packs and design systems from known products

**Assets**

- ⬜ An assets panel: project images, icons and fonts, with usage counts
- ⬜ Upload and use custom fonts, embedded in exports
- ⬜ AI image generation for real photos and illustrations, through the provider layer, replacing placeholders on request

**Done when** a team can keep one design system across projects, and every new screen uses it.

---

## Phase 26: Generation, next steps ⬜

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

## Phase 27: Canvas and editing, next steps ⬜

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

## Phase 28: Prototyping, next steps ⬜

_Principle: Screens are React_

Screens are real React, so prototypes can do more than link screens.

- ⬜ Interactive state: tabs, toggles and forms that work in play mode, written as React state
- ⬜ Scroll behavior: fixed headers and tab bars, and scroll to an anchor
- ⬜ Device frames in play mode and the share viewer
- ⬜ Several starting points (flows), each with a name, in play mode and the share viewer
- ⬜ Smart transitions between matching elements on two screens
- ⬜ Micro-interactions: hover, press and appear animations from presets, as Tailwind classes

**Done when** a usability test can run on a shared prototype with no extra tool.

---

## Phase 29: App and platform ⬜

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
