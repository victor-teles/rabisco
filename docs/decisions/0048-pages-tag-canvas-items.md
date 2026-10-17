# 0048 · Pages are a `page` tag on each canvas item; sticky notes and arrows are canvas-only annotations

- **Status:** proposed
- **Date:** 2026-10-17
- **Extends:** [0004](./0004-alternates-are-files.md), [0029](./0029-moodboard-images-on-the-canvas.md), [0034](./0034-history-follows-moves-and-keeps-images.md)
- **Code:** [`src/shared/pages.ts`](../../src/shared/pages.ts), [`src/mainview/lib/pages.ts`](../../src/mainview/lib/pages.ts), [`src/shared/annotations.ts`](../../src/shared/annotations.ts), [`src/mainview/hooks/use-pages.ts`](../../src/mainview/hooks/use-pages.ts), [`src/mainview/hooks/use-annotations.ts`](../../src/mainview/hooks/use-annotations.ts), [`src/mainview/lib/arrange.ts`](../../src/mainview/lib/arrange.ts)

## Context

Phase 28 asks for pages in a project, each with its own canvas, and for sticky notes and arrows. A project had one canvas: `rabisco.json` held one list each of frames, sections, images and comments. Many parts read `canvas.frames` as "every screen": exports, share links, Play, link targets, generation, the MCP tools and the project summary. When `rabisco.json` lists no frame for a screen file, the screen gets one.

| Option                                                                | Every screen still in `frames` | Cost                                                               |
| --------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| A `page` tag on each item; the canvas shows the open page's items     | yes                            | the canvas and its geometry filter by page                         |
| One `{ frames, sections, … }` per page; the open page's are top-level | no                             | every reader of `frames` must merge pages; orphan screens misplace |
| A separate `rabisco.json` per page                                    | no                             | the store, watcher, history and git sync all change                |

## Decision

**A `page` tag, and annotations as one more canvas list.**

- **Pages.** `rabisco.json` has `pages` (`{ id, name }[]`) and `page`, the open page. Frames, sections, moodboard images, annotations and loose comments have an optional `page`. A pinned comment goes with its screen. A missing `page`, or one that is gone, means the first page. Without `pages`, the project has one page, and nothing changes for older projects.
- **The first extra page** names the existing page "Page 1" and tags every item with it. After that, reordering or deleting pages never moves an untagged item.
- **New items go on the open page.** `ProjectSession.change` tags every new frame, section, image, annotation or loose comment that has no valid `page` with the open page. So generation, paste, the MCP tools and the moodboard need no page logic of their own. A screen that a tool places next to another screen goes on that screen's page.
- **What filters by page:** the canvas, the Screens list, the minimap, select all, zoom to fit, Find, Tidy up, Flow view, comments, and where new screens and images are placed. Sections hold screens on their own page only, so modes and section moves stay on one page. **What doesn't:** exports, share links, Play, link targets, the components and assets panels, "every screen" prompts and the MCP tools. A prototype link can go to a screen on another page.
- **History.** Adding, renaming and deleting a page, and moving screens to a page, are undo steps. Opening a page is not, as in Figma. Deleting a page deletes everything on it, with its screen files; one page always stays. Selecting a screen on another page (from the chat, a link or Find) opens that page. Each page keeps its own view for the session.
- **Annotations.** `annotations` is a list of sticky notes (`kind: "note"`: text, color, rectangle) and arrows (`kind: "arrow"`: two points). They live in `rabisco.json` only. They don't go to the AI, exports, share links or Copy to Figma. Notes use the section colors.
- **Arrange.** Tidy up keeps the selection's rows and their order and puts the cells in columns as wide as their widest, with one gap (`FRAME_GAP`). Flow view puts linked screens in columns by their distance from where the flow starts (screens nothing links to), and screens with no links in a row below. A screen moves with its alternates.

## Shortcuts

`S` sticky note and `⇧L` arrow, as in FigJam and Figma. `⌃⌥T` Tidy up, as in Figma. `PgUp`/`PgDn` previous and next page, as in Figma. Flow view has no Figma equivalent; `⌃⌥F` sits next to Figma's `⌃⌥` arrange keys.

## Why

- **One list of screens.** Every part that needs every screen keeps working. Only the canvas and its geometry learn about pages.
- **One place tags new items.** Tagging in `change` covers every path that creates items, including generations that outlive the editor (decision 0021).

## Consequences

- A generation that ends after the user opened another page puts its screens on the page that is open when it ends.
- Each page's view lasts for the session only.
- Annotations don't attach to screens. Moving a screen leaves its notes and arrows where they are.
