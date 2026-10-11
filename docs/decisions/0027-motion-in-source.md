# 0027 · Motion is Tailwind classes from a preset catalog

- **Status:** proposed
- **Date:** 2026-10-11
- **Extends:** [0002](./0002-incremental-tailwind-in-the-host.md), [0022](./0022-link-transitions-and-overlays.md)

## Context

Phase 26 adds micro-interactions and a motion catalog: hover, press, appear, loop and exit animations that a user applies to an element and tunes in the inspector. The only motion today is link transitions, played by the host with the Web Animations API ([0022](./0022-link-transitions-and-overlays.md)).

`tw-animate-css` is already part of the screen compiler (`src/mainview/lib/render/styles.ts`) and of the exported Vite project, so its `animate-in`, `fade-in`, `slide-in-from-*` and `zoom-in` classes work in frames today. Tailwind's `transition-*`, `duration-*`, `ease-*`, `hover:` and `active:` cover hover and press.

## Options

1. **Tailwind classes.** A preset is a list of classes (`transition-transform duration-200 hover:-translate-y-0.5 active:scale-95`, `animate-in fade-in slide-in-from-bottom-2`). The inspector reads and writes them like other style classes.
2. **The `motion` library.** `<motion.div whileHover={…}>` and springs. More expressive, but a new runtime dependency in the frame module registry and the export, and JSX that is harder to edit as text.
3. **Custom keyframes in DESIGN.md.** Every animation is a token. Flexible, but each preset needs a `@keyframes` block in the theme, and the compiler must rebuild for each new one.

## Proposed decision

**Option 1, with motion tokens in DESIGN.md.**

- **Presets are class lists** in a shared catalog (`src/shared/motion/presets.ts`), grouped as hover, press, appear, loop and exit. Applying one is one undo step that writes classes, and the inspector finds a preset by its classes.
- **Duration, delay and easing are classes** (`duration-300`, `delay-100`, `ease-out`). The inspector edits them with the same rules as other classes: only classes without a variant change.
- **Motion tokens** live in DESIGN.md and map to Tailwind's `--ease-*` and `--animate-*` theme namespaces, the way custom tokens work in [0013](./0013-custom-tokens-names-in-the-compiler.md). Link transitions read the same tokens for their duration and easing.
- **Reduced motion** uses `motion-safe:` and `motion-reduce:` in the presets, so movement becomes a fade, as for link transitions.
- **Snapshots and the canvas** render at the end state. Snapshots wait for, or skip, entry animations; Phase 18 found snapshots that caught them half-drawn.

## Open questions

- Appear on scroll. Tailwind has no scroll trigger. It needs a small runtime helper in the frame and an attribute (`data-motion="in-view"`), which the export must ship too.
- Exit animations need the element to stay mounted while it animates. That works for overlays and menus, but not for any element.
- Whether springs are worth option 2 later, for a few presets only.

## Consequences

- No new dependency. The export already includes `tw-animate-css`.
- The generation prompt lists the presets and motion tokens, so `PROMPT_VERSION` goes up.
- The catalog previews render in sandboxed frames, like component previews.
