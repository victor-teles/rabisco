# Rabisco roadmap

This roadmap lists the work that is still open. Phases are in priority order, and each one delivers something usable on its own. The [principles](./PRINCIPLES.md) explain why it is built this way. Finished work from phases 0–28 is in the [archive](./ROADMAP-ARCHIVE.md); when a phase here is done, move it there.

Each open item links to its Paperclip issue. An item with no issue is not planned yet.

Status: ✅ done · 🚧 in progress · ⬜ not started · 🧭 needs a decision record first

The competitor notes come from a review of MagicPath, Banani and Paper in October 2026.

---

## Phase 29: Prototyping, next steps ⬜

_Principle: Screens are React_

Screens are real React, so prototypes can do more than link screens. All items are in [LIT-57](/LIT/issues/LIT-57), except the last one.

- ⬜ Interactive state: tabs, toggles and forms that work in play mode, written as React state
- ⬜ Scroll behavior: fixed headers and tab bars, and scroll to an anchor
- ⬜ Device frames in play mode and the share viewer
- ⬜ Several starting points (flows), each with a name, in play mode and the share viewer
- ⬜ Smart transitions between matching elements on two screens
- ⬜ A link action that switches a component's variant. A variant is a prop at the call site, so this needs a frame-side override or generated state. It needs its own decision (moved from Phase 26, see [0046](./decisions/0046-link-timing-triggers-and-actions.md)) 🧭

**Done when** a usability test can run on a shared prototype with no extra tool.

---

## Phase 30: App and platform ⬜

_Principle: UX first_

- ⬜ App icon, code signing and notarization on macOS ([LIT-58](/LIT/issues/LIT-58))
- ⬜ Auto-updates and release channels (Electrobun `Updater`) ([LIT-58](/LIT/issues/LIT-58))
- ⬜ Windows and Linux builds, tested end to end ([LIT-58](/LIT/issues/LIT-58))
- ⬜ General settings: default projects folder, default device and style, updates, opt-in crash reports ([LIT-60](/LIT/issues/LIT-60))
- ⬜ Rename, duplicate and export a project from Home ([LIT-60](/LIT/issues/LIT-60))
- ⬜ Project templates on Home: a SaaS dashboard, a mobile app, a landing page ([LIT-60](/LIT/issues/LIT-60))
- ⬜ Empty states in the History, Screens and Layers panels ([LIT-60](/LIT/issues/LIT-60))
- ⬜ Split `canvas.tsx` and `editor.tsx` (about 3,100 and 4,000 lines) with no behavior change ([LIT-59](/LIT/issues/LIT-59))
- ⬜ An accessible editor: keyboard focus through panels, screen reader labels, reduced motion ([LIT-60](/LIT/issues/LIT-60))
- ⬜ Localize the editor ([LIT-60](/LIT/issues/LIT-60))

**Done when** a user can download Rabisco, install it on any OS, and it updates itself.

---

## Open items from finished phases ⬜

Small items left over when phases 24 and 25 were archived.

- ⬜ More uai blocks in the screen runtime, and icon packs besides lucide (from Phase 25)
- ⬜ Load the shipped Inter into screen frames, so text in Rabisco matches Copy to Figma for users without Inter installed. Check the render cost per frame and how export snapshots change, and decide if it needs a decision record (from Phase 24, [0041](./decisions/0041-copy-to-figma-draws-text-from-shipped-inter.md), [LIT-146](/LIT/issues/LIT-146))

---

## Growth and launch ⬜

_Principle: UX first (no dead ends)_

Work outside the app that gets Rabisco to its users. Nothing here is published, posted or paid for without board approval.

- ⬜ Buy the `rabisco.dev` domain. It blocks the website and the telemetry endpoint `t.rabisco.dev` in [0031](./decisions/0031-opt-in-anonymous-funnel-counts.md). A person must do this ([LIT-78](/LIT/issues/LIT-78), blocked on the board)
- ⬜ Read out experiment E3, the README landing page, on 2026-11-08: weekly stars, release downloads and README → releases views against the baseline, with a keep, change or drop call ([LIT-85](/LIT/issues/LIT-85))
- ⬜ Turn shared links into an acquisition loop: a quiet "Made with Rabisco" mark, a download link, what a viewer sees after a comment, and how to measure it with no account ([LIT-41](/LIT/issues/LIT-41))
- ⬜ A public launch plan for after signed builds and auto-updates ship (Phase 30): download page, release notes, Product Hunt and Hacker News, and the funnel from visit to download to first screen ([LIT-61](/LIT/issues/LIT-61))

**Done when** a stranger can find Rabisco, download a signed build, and make a first screen, and we can count each step.

---

## Later

- Real-time collaboration and comments with authors 🧭
- A plugin API for custom providers, exporters and tools 🧭
- A web version that opens shared projects in the browser
- Cloud sync of projects across machines, as an option next to git
- Design reviews: a review mode with approvals per screen
- Run the Phase 18 generation checks with an API key and Ollama, and a real Codex run to check its event mapping (dropped from Phase 18 on 2026-10-13)
- Check the Windows key store on a Windows machine (dropped from Phase 19 on 2026-10-13, no Windows machine)
