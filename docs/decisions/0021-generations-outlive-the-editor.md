# 0021 · Generations outlive the editor: an open project is a session that stays while work runs

- **Status:** accepted
- **Date:** 2026-10-10
- **Extends:** [0012](./0012-chat-sessions-and-provider-commands.md), [0015](./0015-plan-then-screens.md), [0019](./0019-visual-review.md), [0020](./0020-plan-mode.md)
- **Code:** [`src/mainview/lib/project-session.ts`](../../src/mainview/lib/project-session.ts), [`src/mainview/lib/generation-session.ts`](../../src/mainview/lib/generation-session.ts), [`src/mainview/lib/project-sessions.ts`](../../src/mainview/lib/project-sessions.ts), [`src/mainview/lib/sessions.ts`](../../src/mainview/lib/sessions.ts), [`src/mainview/hooks/use-project.ts`](../../src/mainview/hooks/use-project.ts), [`src/mainview/hooks/use-generation.ts`](../../src/mainview/hooks/use-generation.ts)

## Context

The project state, its undo history and the running generation lived in the editor's React hooks. Going back to Home unmounted the editor. Its cleanup stopped the generation, so the main process aborted the run. The run then wrote "Stopped. Nothing was changed." to the chat. A plan waiting for review was lost. If the result came back before the abort, it landed on state nobody held, and the pending writes reached the folder after the watcher had closed, so a later open saw them as external edits that can't be undone.

The main process already keys runs by `generationId`, writes no project files, and aborts only on request. Only the webview tied a run to the editor.

## Decision

**An open project is a session outside React. The editor attaches to it and detaches from it. Back never stops a generation.**

- `ProjectSession` holds what `useProject` held: the state, the history, the files on disk, the canvas last saved, the debounce timers, the chat and the images. `GenerationController` holds what `useGeneration` held: the live generation, the failure, the waiting plan, the last run, and every step of a run (DESIGN.md, plan, files, polish and review).
- A registry keeps one session per path. A session stays while something holds it: the editor while attached, work while a run or a waiting plan exists, and an unseen result that landed while detached. When the last hold goes, the registry writes what is pending, then closes the project (the watcher stops), then drops the session. At most 4 sessions are kept only for an unseen result; the oldest goes first.
- `useProject` and `useGeneration` are thin adapters over the session, with the same return shape. Opening a project that has a live session reuses it: no second `openProject`, and the history is still there.
- A result always lands through the session's `change` as one undo step. The polish and the review join it with the same coalesce key, attached or not. While detached, the canvas is saved right after the result lands and again when the run ends, so Home's covers and recents are current.
- A run writes all its messages to the chat it started in, even if the user opens another chat meanwhile.
- One generation per project. Different projects can generate at the same time; events are routed by `generationId` from one subscription.
- The editor-only parts of a run are attach callbacks: fitting the view to new frames, the "Resolved" toast, and the render check of the frames on the canvas. While detached there are no frames on the canvas, so the render check and its automatic repair are skipped; a screen that fails shows its error when reopened, and Fix still works. The new frames stay selected, so the editor fits them when it opens.
- The theme read (`readTheme`) and "Improve prompt" belong to the editor and the composer that apply their result, so they still stop when those unmount.

**Home shows the work.**

- A project card shows "Generating…" with a spinner, "Plan ready to review" or "Failed" instead of its meta line. Its menu has "Stop generating" while a run is going.
- When a run ends or a plan arrives while its project is not open, a toast says so with Open: "Screens for {name} are ready", "Couldn't finish {name}", "Plan for {name} is ready to review". Home reloads the recents.
- "Move to Trash" on a busy project stops the run and drops the session without writing what is pending. The dialog says so.

## Why

- **Fast feedback, no dead ends** ([principle 1](../PRINCIPLES.md#1-ux-first)). Leaving the editor is not a request to stop. A long generation no longer locks the user into one project.
- **Everything is undoable.** A result that lands while away is one undo step in the same history the user returns to.
- **Providers stay interchangeable.** Nothing in `src/bun/` changed.

## Consequences

- The undo history lives as long as the session. After an eviction or a restart, history starts again from the files, as before.
- Images in `public/` are pushed to frames from one global store ([0010](./0010-project-images-pushed-to-frames.md)), which holds the attached project's images. A review that runs while its project is detached renders without that project's images. Opening a project while another project generates adds its Tailwind candidates instead of resetting the build, so the other project's offstage renders keep their classes.
- Quitting the app while a run is going loses the run, as before. There is one window, so at most one editor is attached.
- If the project folder is moved or deleted while a run is going, the writes fail, the run is marked failed, and Home toasts it.
