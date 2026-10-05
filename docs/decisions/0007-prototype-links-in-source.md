# 0007 · Prototype links live in the source

- **Status:** accepted
- **Date:** 2026-10-04

## Context

Phase 6 adds prototype links between screens and a play mode. A link says "a click on this element goes to that screen". It could live in `rabisco.json`, keyed by an element id, or in the screen's TSX, next to the element it belongs to.

## Decision

**A link is an attribute on the element in the TSX.** The value is the target screen's path, or `back` to go to the previous screen:

```tsx
<Button data-link-to="screens/settings.tsx">Settings</Button>
<button data-link-to="back">Cancel</button>
```

- **Only string literals are links.** `data-link-to={target}` is code: the canvas and play mode ignore it, and the inspector shows it read-only.
- **Reading is forgiving.** `settings`, `./settings.tsx` and `/screens/settings.tsx` all resolve to `screens/settings.tsx`. The inspector writes the full path.
- **A link to a screen that doesn't exist is broken, not removed.** The canvas draws it dashed, the inspector shows "Missing", and play mode shows a toast. The user decides what to do. `retargetLinks` updates links when Rabisco renames a screen.
- **Links point at the screen, not a variation.** Picking an alternate swaps file contents ([0004](./0004-alternates-are-files.md)), so links to `welcome.tsx` follow the picked design.
- **Links work on components too.** The attribute is an ordinary prop. In play mode the frame reads it from React's fiber chain, so a component that doesn't pass it to the DOM still links. A link written inside a component file applies on every screen that renders it. The canvas draws only links written in screen files.
- **Play mode is a frame mode, not a different renderer.** The host sends `play`. The runtime then catches clicks on linked elements in the capture phase and posts `navigate`. Everything else is the real React screen: state, inputs and menus keep working.

## Why

- [Principle 3](../PRINCIPLES.md#3-screens-are-react): the file is the design. A link in the source is readable, survives edits in another editor, and is in the diff.
- Generations rewrite whole files. An id stored outside the file would lose its element on every edit, but an attribute moves with it, as long as the generation prompt asks models to keep `data-link-to`.
- Export (Phase 7) can turn the attribute into router navigation with a code transform. It doesn't need a side table.
- Element identity in the editor is `{ file, start }`, which changes on every edit. An attribute needs no identity at all.

## Consequences

- The attribute ships in the exported code until the Phase 7 export wires it to a router or strips it. It is a harmless `data-*` attribute in the DOM.
- A link the model writes as code (`data-link-to={next}`) is invisible to the canvas. That is acceptable: it is still code that a developer can read.
- Deleting a screen leaves broken links visible on the canvas instead of silently editing other files.
