# 0004 · Variations and alternates are files

- **Status:** accepted
- **Date:** 2026-10-04

## Context

[Principle 6](../PRINCIPLES.md#6-variations-not-verdicts): a generation can produce several variations of a screen. The user picks one, and the others are kept as alternates. Alternates could live inside `rabisco.json`, or as files next to the screen.

## Decision

**Every variation is a file in `screens/`.** The picked variation keeps the screen's name, and the others get an `.alt-N` suffix:

```
screens/
  welcome.tsx          # picked: this is "the" Welcome screen
  welcome.alt-1.tsx
  welcome.alt-2.tsx
```

- `rabisco.json` stores only canvas data: frame positions and sizes, which files form a variation group, and which file is picked. It never stores code.
- **Picking an alternate swaps file contents**: the picked file becomes `welcome.tsx`, and the previous one becomes the alternate. That way imports and links to `welcome.tsx` keep working.
- **New variations of a screen** take the next free `alt-N` number.
- **Deleting an alternate** deletes its file.
- Alternates are full screens: they render, compile and export like any other screen. Export can include or skip them.

## Why

- It matches principles 3 and 5: code lives in files that people can open, diff and keep in git.
- Alternates use the same compile cache and module registry as screens ([0001](./0001-compile-tsx-in-the-webview.md)), so they need no special path.
- It fits the provider contract ([0003](./0003-ai-provider-contract.md)): providers write one logical file, and Rabisco decides the final names.

## Consequences

- File watching must recognise the `*.alt-N.tsx` pattern and group those files with their screen. Groups are derived from the file names (`src/shared/variations.ts`), and `rabisco.json` mirrors them when the canvas is saved.
- A variation run that writes components gets them as `components/<name>-vN.tsx`, with its imports rewritten, unless the content matches the primary's version.
- If the user renames a file outside Rabisco, it becomes an independent screen. That is acceptable and visible.
