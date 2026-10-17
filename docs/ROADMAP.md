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
- ✅ More modes than light and dark in DESIGN.md (brand, density, contrast), each a group of named options with its own token values. A `### Brand mode: Acme` heading starts an option, with its own `#### Dark`. The tokens panel lists the groups ([LIT-155](/LIT/issues/LIT-155))
- ✅ A Theme row in the section inspector and menu: pick an option for each mode group (Auto, then each option; one row per DESIGN.md group). Screens inside follow it at once, and a screen dragged in or out re-themes on drop
- ✅ Nested sections inherit: the innermost section that sets a group wins, and groups it leaves unset come from the section around it, then the project default
- ✅ A screen can set its own mode from its menu or the inspector, which wins over its section
- ✅ Token overrides on a section: change a token for that section only, to try a new primary color or radius next to the current one. "Save as mode" writes it to DESIGN.md as a new option; "Apply to project" makes it the project value; "Discard" drops it. Each is one undo step. The canvas, snapshots, covers, play, image export, Copy to Figma and a share link on the local network show drafts; code, HTML and website export, publish and Copy for agent leave them out, and the publish dialog counts them ([LIT-156](/LIT/issues/LIT-156), `views/editor/section-draft.tsx`)
- ✅ "Duplicate with mode": copy a section and its screens with another mode, to compare them side by side. The copies are files, and links inside the copy point at the copy. The copy sits one gap to the right, takes nested sections and the draft along, and is one undo step ([LIT-157](/LIT/issues/LIT-157), `src/shared/duplicate-section.ts`)
- ✅ Play mode, the share viewer, image export, Copy to Figma, visual review, snapshots, HTML and the code export use each screen's resolved mode. The code export wraps each route in a `ScreenMode` component, so a screen exports the way it looks on the canvas ([LIT-154](/LIT/issues/LIT-154))
- ✅ Generations and point and prompt see the screen's mode and its dark token values. Copy for agent and the MCP `get_project` name each screen's mode ([LIT-154](/LIT/issues/LIT-154))
- ✅ The dark mode pass in Phase 27 checks screens in dark mode, as a Dark section would show them ([LIT-52](/LIT/issues/LIT-52))

**Components**

- ✅ A component page with every variant and state side by side: "Open page" in a component's detail shows the first two variant axes as a table, the other axes as rows, and each boolean prop (and `disabled` on form elements) as a state (`views/editor/component-page.tsx`, `componentPageModule` in `src/shared/components/preview.ts`)
- ✅ Edit variants visually: add an option to a `cva` axis, set its classes, remove an unused option. Each option shows how many usages pick it, and the page lists every file that uses the component (`src/shared/components/variant-edit.ts`)
- ✅ Edit slots visually: the `children` and node props a component renders, filled per usage. The component page's Slots section counts how each usage fills a slot (text, elements, code or empty) and lists every usage, with text editable in place. In the inspector, a slot holding elements shows them as chips that select them, and either place can empty a slot, dropping imports it no longer needs ([LIT-158](/LIT/issues/LIT-158), `src/shared/components/slots.ts`)
- ✅ Swap a component for another in place, keeping matching props: "Swap" in the inspector's component header lists the project's components with how many of the usage's props each keeps. The tags are renamed, props and children the new one doesn't take are dropped (the toast names them), and the imports follow (`src/shared/jsx/swap.ts`)
- ✅ Shared libraries across projects: a folder of components and tokens that projects copy in. "Library" in the design system view makes one from a project, uses one, takes its updates, settles conflicts and publishes changes back, compared three ways against the project's `library.json` ([0045](./decisions/0045-shared-libraries-are-copied-in.md), `src/shared/libraries.ts`, `views/editor/library-dialog.tsx`)
- ✅ Starter kits beyond shadcn: the Home composer's kit picker writes a kit's components into the new project's `components/` folder. Dashboard, Marketing site, iOS and Material, built from the shadcn primitives and theme classes so they follow DESIGN.md; shadcn alone stays the default (`src/shared/components/starter-kits.ts`, [LIT-160](/LIT/issues/LIT-160))
- ⬜ More uai blocks in the screen runtime, and icon packs besides lucide

**Assets**

- ✅ An assets panel (`⌥4`, a tab of the left panel): project images, fonts and lucide icons, each with its use count and the screens that use it. Unused images and fonts can be deleted as an undo step ([0047](./decisions/0047-fonts-in-public-and-images-from-providers.md), [LIT-48](/LIT/issues/LIT-48), `views/editor/assets-panel.tsx`, `src/shared/asset-usage.ts`)
- ✅ Upload and use custom fonts: "Add font" copies woff2, woff, ttf or otf files to `public/fonts/`, named for their family, weight and style, and adds a `font-<family>` token to DESIGN.md. Frames load them with `FontFace`. The code, HTML and website exports, share links and publish embed them (`src/shared/fonts.ts`)
- ✅ AI image generation for real photos and illustrations, through the provider layer, replacing placeholders on request: the Assets panel lists the photo, avatar, illustration and map placeholders, and "Replace all" or one placeholder's button makes an image for each. The images go to `public/images/`, and all the replacements are one undo step. Providers may implement `generateImage` (OpenAI and OpenRouter do), and nothing outside `src/bun/ai/providers/` knows which one runs (`src/shared/placeholder-images.ts`)

**Done when** a team can keep one design system across projects, and every new screen uses it.

---

## Phase 26: Components and motion 🚧 🧭

_Principles: Component based by default · Direct manipulation over prompts · Screens are React_

A component can be edited only from the Components tab or the code view, a usage can't differ from it except through its props, links are made one at a time in the inspector, and screens have no motion beyond link transitions. Figma users expect a main component with instances, links drawn on the canvas, and animation presets.

**Main component and instances** ([0026](./decisions/0026-component-overrides-in-source.md))

- ✅ Edit a component from any usage on the canvas: step inside the usage, edit its elements in place, and see every other usage update. A bar names the component and its usage count, and Esc steps out
- ✅ "Go to component" from a usage's menu: select the component in the Components tab and open its file
- ✅ Overrides on one usage: text, string props and classes changed on that usage only, written at the call site. The inspector marks overridden fields
- ✅ "Reset overrides" on a usage, and "Apply to component" to move a usage's overrides into the component for every usage
- ✅ "Detach" (⌥⌘B) inlines a usage as plain JSX, with its props filled in
- ✅ Layers and the inspector show usages as instances, with the component's name and a link to it

**Prototype links on the canvas**

- ✅ Drag from a selected element's link handle to a screen to link it, as in Figma. Drop on empty canvas to cancel (`views/editor/link-handle.tsx`)
- ✅ Click a connector to select the link: edit its transition and mode in a popover, Delete removes it
- ✅ Duration and easing for a transition, `data-link-duration` and `data-link-easing` ([0046](./decisions/0046-link-timing-triggers-and-actions.md), extends [0022](./decisions/0022-link-transitions-and-overlays.md)). The defaults move to motion tokens with the Motion items below
- ✅ Triggers other than a click: hover, press, after a delay, and a key, `data-link-trigger` ([0046](./decisions/0046-link-timing-triggers-and-actions.md))
- 🚧 Actions other than navigate: scroll to an element (`#id`) and open a URL are done ([0046](./decisions/0046-link-timing-triggers-and-actions.md)). Switching a component's variant needs its own decision 🧭

**Motion** ([0027](./decisions/0027-motion-in-source.md) 🧭)

- ✅ A motion catalog in the left panel (⌥5): hover, press, appear, loop and exit presets, each with a live preview (`views/editor/motion-panel.tsx`)
- ✅ Drag a preset onto an element, or apply it from the element menu (Motion) or by clicking it in the catalog, as one undo step
- ✅ A Motion section in the inspector: the element's presets, with duration, delay and easing, and a replay button
- ✅ Motion tokens in DESIGN.md (`duration-*` and `ease-*`), offered with the presets' timing, used by link transitions as `duration-default` and `ease-default`, and listed to generations
- ✅ Generations use the presets and tokens, and point and prompt can add motion ("a subtle entrance for this list")
- ✅ Snapshots, exports and reduced motion: frames snapshot at the end state, the export keeps the classes, and reduced motion turns movement into a fade (`motion-safe:` in every preset)

**Done when** a user can change a button inside one card on the canvas and see every card update, override the label of one card, link three screens by dragging, and add a hover and an appear animation, with no prompt and no code view.

---

## Phase 27: Generation, next steps 🚧

_Principles: UX first (a bad generation costs one keystroke) · Variations, not verdicts_

- ✅ Next screen from an element: click a button, describe where it goes, and get the linked screen in the same style (Banani's favorite flow). "Next screen…" (⌥⌘N) in the element menu makes one screen from the source screen as a reference, and writes the link on the element in the same undo step (`src/shared/ai/follow-ups.ts`)
- ✅ Project-wide edits: "make every heading bolder" across screens, as one undo step with a summary by screen. `/all <change>` or "Edit every screen…" runs one edit per screen, four at a time, each allowed to write only its own screen (`src/bun/ai/screen-runs.ts`)
- ✅ Responsive variants: generate the tablet or desktop version of a mobile screen, or the other way, linked as one screen. Generate → "Desktop version" (or `/responsive desktop`) adds an alternate at that size, named "Home · Desktop"
- ✅ States on request: empty, loading, error and filled versions of a screen, as alternates. Generate → "Screen states" (or `/states`) sends one prompt per state and names each alternate
- ✅ A dark mode pass that checks every screen against the dark tokens. Generate → "Dark mode pass" (or `/dark`) renders the selected screens, else all, in dark mode, and repairs the ones with low contrast or colors without a token, one run per screen (`src/shared/design/dark-pass.ts`)
- ✅ Stop one screen in a parallel run without stopping the others; retry one failed screen. A planned create or a run of variations lists its screens or variations under the steps, each with a stop button (`stopGenerationPart`). The reply offers "Try … again" for each stopped or failed one: a planned screen runs alone from the same plan, a variation runs as one more of the first screen (`src/shared/ai/run-parts.ts`, [LIT-53](/LIT/issues/LIT-53))
- ✅ Show tokens and cost per generation in the chat, and a running total per project. Each reply keeps what its plan, DESIGN.md, generation and polish runs used, as the providers report it (cost only when the provider sends one). The chat header shows the total of the project's chats, with a tooltip (`src/shared/ai/usage.ts`)
- ✅ Queue a prompt while a generation runs, instead of disabling the composer. The composer stays open; sending queues the prompt for the selection it was written for, and queued prompts go out in order once the run settles and no plan waits for review. Each can be removed
- ✅ Realistic content: copy and data from PRODUCT.md, with a "Shuffle content" action. The prompt (v24) takes content from PRODUCT.md; Generate → "Shuffle content" (or `/shuffle`) rewrites the selected screens' text and data, keeping layout and classes
- ✅ An accessibility check next to "Check design": labels, focus order, tap targets and landmarks. "Check accessibility" in the command palette renders the screens offstage and reads names, roles, Tab order and target sizes (44px on phones and tablets). "Fix in chat" puts the findings in the composer as one prompt, with their screens selected ([LIT-54](/LIT/issues/LIT-54), `src/shared/design/accessibility-checks.ts`)
- ✅ Cross-screen consistency check: the same component, spacing and nav across screens. "Check consistency across screens" compares screens of the same width: buttons and fields that differ in height, corners or text size from most, hand-made ones where others use the component, page padding, and nav items, size or absence (`src/shared/design/consistency-checks.ts`)
- ⬜ A prompt library: save and reuse prompts per project, and see past prompts per screen
- ✅ Model presets per task in Settings (create, edit, review), on top of the fast model. "Models by task" picks a model for new screens and variations, for edits and fixes, and for the visual review; an unset or unavailable one falls back to the fast model, then the picked one (`modelForTask` in `src/shared/ai/settings.ts`)

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
