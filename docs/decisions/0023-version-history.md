# 0023 · Version history: checkpoints are git commits; AI changes are session snapshots

- **Status:** accepted, partly superseded by [0024](./0024-history-in-app-data.md) (history and session versions are saved in app data)
- **Date:** 2026-10-10
- **Extends:** [0008](./0008-share-link-and-git-sync.md), [0021](./0021-generations-outlive-the-editor.md)
- **Code:** [`src/bun/git.ts`](../../src/bun/git.ts), [`src/shared/git.ts`](../../src/shared/git.ts), [`src/mainview/lib/versions.ts`](../../src/mainview/lib/versions.ts), [`src/mainview/views/editor/history-panel.tsx`](../../src/mainview/views/editor/history-panel.tsx)

## Context

Phase 17 asks for a version history panel: named checkpoints (⌥⌘S) and the AI changes of the session, each with a preview and Restore. The roadmap says it builds on undo history and git sync, with no new storage when git is set up. Restore must be undoable, and git history must never be rewritten.

## Decision

**A checkpoint is a commit when the project has git, and a snapshot in the session when it doesn't.**

- With git, ⌥⌘S writes what is pending, then commits the project folder (`commit --allow-empty -- .`), the same way sync commits ([0008](./0008-share-link-and-git-sync.md)). The subject is `Rabisco checkpoint: <name>`, the body lists the files, and a `Rabisco-Checkpoint: <folder>` trailer names the project folder in the repository (`.` at the root). Other staged files stay staged.
- The commit is made even when nothing changed, so every name the user saves is kept. Listing reads `git log --grep` on the trailer, not the project path, because a path-limited log hides empty commits. The trailer keeps another project in the same repository out of the list.
- A commit and not a tag: a commit captures uncommitted work in one step, the next sync pushes it with no extra flags, a name can have spaces, and nothing is added to the repository's shared tag namespace.
- Without git (or in the browser), a checkpoint is the current undo snapshot, kept in the session. It lasts until the session ends, like undo history ([0021](./0021-generations-outlive-the-editor.md)). The panel says so and points to Export to set up git. Nothing is written to the project.

**AI changes are the snapshots that generations already make.** When a result lands (after its polish or review), the session records its undo step with the prompt's first line and the files it changed. It costs no extra storage and no RPC; snapshots share their file strings with history.

**Preview and Restore.**

- A session version previews from its snapshot. A git checkpoint is read once when its row opens (`gitReadCheckpoint`: `ls-tree` and `cat-file` at the commit, project files and `rabisco.json` only) and kept while the panel is open. The screens render as thumbnails with the existing offscreen snapshot frames.
- Restore is one undo step through the session's `change`: it puts back the files, frames, theme, sections and locks of the version, and keeps comments, the project name and the device. The writes go through `writeFiles` like any edit. Restore never checks out, resets or force-pushes; the restored files are new changes for the next sync or checkpoint.

**RPC stays off hot paths** ([0005](./0005-rpc-round-trip-floor.md)): one `gitStatus` and one `gitCheckpoints` when the panel opens, one read per opened checkpoint, and one commit per save.

## Why

- No new storage: git already holds versions for projects that use it, and the session already holds snapshots for the AI changes.
- Never destructive: restoring is an edit, so ⌘Z takes it back and git history only grows.
- The panel works without git and without AI, as the rest of the editor does.

## Consequences

- Without git, checkpoints and AI changes are gone after the project's session ends. With git, only checkpoints survive; AI changes are listed for the session only.
- Images under `public/` aren't project files ([0010](./0010-project-images-pushed-to-frames.md)), so Restore doesn't bring back a deleted image.
- Empty checkpoint commits show up in `git log` as commits with no files.
- A checkpoint saved in another clone appears after a sync brings its commit in.
