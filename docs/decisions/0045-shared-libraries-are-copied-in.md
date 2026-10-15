# 0045 · Shared libraries are folders that projects copy from; `library.json` records what was synced

- **Status:** proposed
- **Date:** 2026-10-15
- **Extends:** [0006](./0006-components-from-source.md), [0008](./0008-share-link-and-git-sync.md), [0013](./0013-custom-tokens-names-in-the-compiler.md), [0044](./0044-token-tools-rewrite-uses-in-source.md)
- **Code:** [`src/shared/libraries.ts`](../../src/shared/libraries.ts), [`src/bun/libraries.ts`](../../src/bun/libraries.ts), [`src/mainview/views/editor/library-dialog.tsx`](../../src/mainview/views/editor/library-dialog.tsx)

## Context

A team that designs several products wants one set of components and tokens. Today each project has its own `components/` and its own DESIGN.md. A button fixed in one project stays broken in the others, and a new project starts from nothing.

Three things had to be settled: where a library lives, whether a project links to it or copies it, and what code export and git sync do with it.

Linking was the first idea: frames would import `@library/button` from a folder outside the project. It breaks three rules at once. Screens are sandboxed and get their files from the project (decision 0001), so the main process would have to watch and push a second folder. Git sync is scoped to the project folder (0008), so a clone would not build. And every change in the library would re-theme every project at once, without an undo step in any of them.

## Decision

**A library is a plain folder of components and tokens. A project copies it in. A `library.json` in the project records the library and what each file and token looked like at the last sync, so updates and publishing are a three-way compare.**

- **The library folder** holds `rabisco-library.json` (`{ "id", "name" }`), `DESIGN.md` with a `## Tokens` section, and `components/<kebab-name>.tsx`. Nothing else is read or written. "Make a library" creates one in `~/Documents/Rabisco/Libraries/<name>/` from the project's components and tokens. "Add a library folder…" adds any folder with a `rabisco-library.json`, for example a git clone the team shares. Rabisco does not sync the library folder itself: a team keeps it in git, a shared drive or anything else.
- **Which libraries a Mac knows** is app data, not project data: the folders in `~/Documents/Rabisco/Libraries/` plus the added ones in `<userData>/libraries.json`. The project only stores the library's `id` and `name`, so two people with the library in different places share the same `library.json`. A library this Mac doesn't know shows as "not found" with "Add a library folder…".
- **Copy, not link.** "Use library" writes the library's components into the project's `components/` and its tokens into DESIGN.md's `## Tokens`, as one undo step. A component that exists in both with different content is a conflict, and the project keeps its own until the user picks the library's. From then on they are ordinary project components and tokens: generations reuse them (the prompt already lists project components), the inspector edits them and the component page shows them.
- **`library.json`** is a project file next to DESIGN.md: `{ "id", "name", "files": { "components/button.tsx": "<hash>" }, "tokens": { "light": {…}, "dark": {…} } }`. Files are stored as a hash and tokens as values, so a diff in git reads well. Every library action writes it in the same undo step as the files it changes.
- **Updates** compare each component and token three ways: the project, the library, and the last sync in `library.json`.
  - Only the library changed: an update. "Update" takes them all in one undo step.
  - Only the project changed: a change to publish.
  - Both changed, to different values: a conflict. "Use library's" takes it; "Keep mine" records the library's version as synced, so the project's version becomes a change to publish.
  - Removed from the library: the project keeps its copy and it is no longer linked. Removing a component screens use would break them.
- **Publishing** writes the checked changes into the library folder. A project component that is not in the library can be added; the project components it imports come with it. A component or token deleted in the project can be removed from the library, unchecked by default. Writing the library is not an undo step, because other projects read it; the project's `library.json` is updated as one.
- **One library per project.** A second library would need an order for conflicting names. Unlink keeps every file and token and removes `library.json`.
- **A new project** uses a library in one step from the design system view: "Library", then "Use". Its first screen is generated with the library's components and tokens, like every screen after it.
- **Code export and git sync** need nothing new. The library's components are in `components/` and its tokens are in DESIGN.md, so the code export writes them like any component and theme, and a clone builds without the library folder. Git sync commits `library.json` with the project, so a teammate who opens it sees the same link and the same sync state. The code export does not write `library.json`, because an exported app has no library to sync with.

## Consequences

- A team keeps one design system across projects: fix the button once, publish, and each project takes the update when it chooses. Each project's history has the update as one ⌘Z.
- Projects are self-contained. They open, render, export and build on a Mac that doesn't have the library.
- Updates are pulled, not pushed. A project shows how many updates wait when the library dialog opens; there is no watch on the library folder.
- Compare is per file and per token, not per line. Two people changing different lines of one component get a conflict, and one of them picks a version.
- A library carries components and tokens only. Images in `public/`, fonts and DESIGN.md's prose stay per project.
- `library.json` is a new project file. The watcher, the saved history and git sync treat it like DESIGN.md. The AI never writes it.
