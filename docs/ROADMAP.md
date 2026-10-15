# Rabisco roadmap

This roadmap lists the work that is still open. Phases are in priority order, and each one delivers something usable on its own. The [principles](./PRINCIPLES.md) explain why it is built this way. Finished work from phases 0–24 is in the [archive](./ROADMAP-ARCHIVE.md); when a phase here is done, move it there.

Status: 🚧 in progress · ⬜ not started · 🧭 needs a decision record first

The competitor notes come from a review of MagicPath, Banani and Paper in October 2026.

---

## Phase 25: Design system ⬜

_Principles: Component based by default · Context is a file_

Open items from phase 14, plus the gaps that make design system work hard.

**Tokens**

- ✅ A design system view (`⌥3`, or the Context panel's Tokens header): tokens by kind with where screens use them, rename with uses rewritten, delete with a use count (detach and delete, or delete only), `shadow-*` and `font-weight-*` tokens ([0044](./decisions/0044-token-tools-rewrite-uses-in-source.md), `views/editor/design-system-dialog.tsx`, `src/shared/context/token-usage.ts`)
- ✅ Find raw values that match a token ("12 raw values in 4 screens match tokens"): arbitrary values and palette colors, replaced all at once or per token; detach a token's uses back to its value, with a `dark:` class for a dark value
- ✅ Import tokens from DTCG or Figma Variables JSON, pasted shadcn CSS or a tweakcn link: "Import tokens…" takes a link, pasted text or a file (`src/shared/context/token-import.ts`)
- ✅ Text styles: `text-heading: 2rem/1.2 600 -0.01em` sets size, line height, weight and tracking as one class. The inspector's Style row applies one or detaches it (`src/shared/tailwind/text-style.ts`)

**Themed sections** ([0028](./decisions/0028-themed-sections.md), built in five steps, dark on frames first)

Figma sets a variable mode on a section, and every frame inside follows it. Rabisco sections can do the same with token modes, and can also try out token changes before they reach the project.

- ✅ Dark mode on frames: a section or a screen set to Dark adds `.dark` to the frame's `<html>`, so the `### Dark` tokens in DESIGN.md show on the canvas, in the screens panel, covers, history and play (`src/shared/modes.ts`)
- ⬜ More modes than light and dark in DESIGN.md (brand, density, contrast), each a group of named options with its own token values
- ✅ A Theme row in the section inspector and menu: pick an option for each mode group (Auto, Light or Dark until more groups exist). Screens inside follow it at once, and a screen dragged in or out re-themes on drop
- ✅ Nested sections inherit: the innermost section that sets a group wins, and groups it leaves unset come from the section around it, then the project default
- ✅ A screen can set its own mode from its menu or the inspector, which wins over its section
- ⬜ Token overrides on a section: change a token for that section only, to try a new primary color or radius next to the current one. "Save as mode" writes it to DESIGN.md as a new option; "Apply to project" makes it the project value; "Discard" drops it
- ⬜ "Duplicate with mode": copy a section and its screens with another mode, to compare them side by side. The copies are files, and links inside the copy point at the copy
- ⬜ Play mode, the share viewer, image export, snapshots and the code export use each screen's resolved mode. The export sets it on each screen's route, so a screen exports the way it looks on the canvas
- ⬜ Generations and point and prompt see the screen's mode and its tokens, and the dark mode pass in Phase 27 checks screens in a Dark section

**Components**

- ✅ A component page with every variant and state side by side: "Open page" in a component's detail shows the first two variant axes as a table, the other axes as rows, and each boolean prop (and `disabled` on form elements) as a state (`views/editor/component-page.tsx`, `componentPageModule` in `src/shared/components/preview.ts`)
- ✅ Edit variants visually: add an option to a `cva` axis, set its classes, remove an unused option. Each option shows how many usages pick it, and the page lists every file that uses the component (`src/shared/components/variant-edit.ts`)
- ⬜ Edit slots visually: the `children` and node props a component renders, filled per usage
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
- Run the Phase 18 generation checks with an API key and Ollama, and a real Codex run to check its event mapping (dropped from Phase 18 on 2026-10-13)
- Check the Windows key store on a Windows machine (dropped from Phase 19 on 2026-10-13, no Windows machine)
