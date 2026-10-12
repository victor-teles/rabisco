# 0034 · Saved history follows a moved folder, keeps `public/` images, and backups include images and chats

- **Status:** accepted
- **Date:** 2026-10-12
- **Supersedes:** part of [0024](./0024-history-in-app-data.md) (a moved folder starts history again; history and backups leave out images and chats), part of [0029](./0029-moodboard-images-on-the-canvas.md) (deleting a canvas image leaves its file)
- **Extends:** [0010](./0010-project-images-pushed-to-frames.md), [0023](./0023-version-history.md)
- **Code:** [`src/bun/saved-history.ts`](../../src/bun/saved-history.ts), [`src/bun/assets.ts`](../../src/bun/assets.ts), [`src/mainview/lib/history.ts`](../../src/mainview/lib/history.ts), [`src/mainview/lib/project-session.ts`](../../src/mainview/lib/project-session.ts), [`src/mainview/lib/moodboard.ts`](../../src/mainview/lib/moodboard.ts)

## Context

Saved history ([0024](./0024-history-in-app-data.md)) is keyed by the folder's path. A moved or renamed folder found no history, and its backups stayed under the old path. Images under `public/` were not part of history, so nothing could bring one back. Backups held the screens and `rabisco.json`, but not the images or the chats.

## Decision

**A moved folder takes its history with it.**

- Next to each history file, `<key>.meta.json` stores the folder's path and the `createdAt` of its `rabisco.json`. It is written with the history.
- When a project opens and there is no history for its path, Rabisco looks for a history with the same `createdAt` whose old path no longer holds that project. It moves the history, its saved images and its backups to the new path. If several match, the newest wins.
- A copy of a folder keeps its original in place, so the copy starts its own history. Projects without `createdAt`, or without a history written since this change, start again as before.

**History keeps the images under `public/`.**

- The main process sends a content digest (the first 32 hex digits of a SHA-256) for each image when a project opens and with each image change. Each snapshot stores `assets`: the digest by `src`. Saved history stores them too.
- Before Rabisco removes or replaces an image, it copies the bytes to `<userData>/history/<key>.images/<digest>`. Undo and redo send `writeAssets` with the images the snapshot needs. The main process writes them from those copies. When a copy is missing, the image leaves history, and the user sees one error.
- An image added, changed or removed outside Rabisco is folded into every snapshot, the same way as a file ([0024](./0024-history-in-app-data.md)). Undo never reverts it.
- Writing history deletes the saved copies that no step or version refers to.
- Deleting a moodboard image from the canvas also deletes its file when no other canvas image and no screen uses it. Undo brings back both.

**Backups include images and chats.**

- A backup copies `public/`, `chats/` and `attachments/` with the screens, `rabisco.json`, `chat.jsonl` and `history.json`. Its layout is a project folder. Copy it back, or open it as a project, to restore it.

## Why

- **Everything is undoable** ([principle 1](../PRINCIPLES.md#1-ux-first)), including images, and after a rename.
- **The project folder stays clean.** Old images go to app data, not to the repository.
- **Copies are cheap.** Rabisco saves an image only when it is about to remove or replace one, and the same bytes are stored once.

## Consequences

- Moving a folder to another computer or another clone does not carry the history. Git checkpoints remain the way to share versions.
- A backup can be large when `public/` is. Only the 10 newest are kept for each project.
- Restoring a session version brings back the images it had. Images added since stay.
- In browser mode (`hutch run hmr`) there are no digests, so images stay out of history.
