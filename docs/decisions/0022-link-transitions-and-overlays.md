# 0022 · Link transitions and overlays live in the source too

- **Status:** accepted
- **Date:** 2026-10-10
- **Extends:** [0007](./0007-prototype-links-in-source.md)

## Context

Phase 17 adds two things Figma prototypes have and Rabisco's links don't: an animation between screens, and a screen that opens over the current one as a modal or a sheet. Decision 0007 puts a link in the TSX as `data-link-to`. The new settings belong to the same link, so they need a home next to it.

## Decision

**A link's transition and mode are two more attributes on the same element.**

```tsx
<Button data-link-to="screens/profile.tsx" data-link-transition="push">Profile</Button>
<Button data-link-to="screens/filters.tsx" data-link-mode="sheet">Filters</Button>
<Button data-link-to="screens/confirm.tsx" data-link-mode="overlay" data-link-transition="instant">Delete</Button>
```

- **`data-link-transition`** is `instant`, `dissolve`, `slide` or `push`. Slide moves the new screen in from the right over the old one; push moves both. Unknown values count as not written. Without the attribute a link is instant, as before.
- **`data-link-mode`** is `overlay` (a modal, centered) or `sheet` (on the bottom edge, full width). `modal` reads as `overlay`. Anything else, or no attribute, navigates. One attribute with two values, instead of `overlay` plus a companion attribute for the kind, keeps the common case to one attribute.
- **An overlay's default transition depends on its kind:** a modal dissolves and a sheet slides up. The inspector writes a transition only when it differs from the default, so most links stay one attribute.
- **Same rules as `data-link-to`.** Only string literals count; reading is forgiving about case and spaces; the attributes work on components and are read from React's fiber chain in play mode. The frame sends them with `navigate`; the host parses them (`src/shared/prototype/transitions.ts`).
- **Back reverses the way in.** `back`, the Back button and the browser's back button play the reverse of the transition that opened the screen being left, so a push comes back as a push. A `back` link has no transition or mode of its own: the inspector hides both, and pointing a link at `back` or removing it removes them.
- **Overlays stack on the current screen.** The overlay screen renders at its own frame size, clamped to the screen's (a sheet takes the screen's width), over a dimmed backdrop. A click on the backdrop, Esc, or a `back` link closes the top overlay. A plain link from an overlay closes every overlay and navigates.
- **Reduced motion turns movement into a fade.** With `prefers-reduced-motion`, slide and push dissolve, and sheets fade in.
- **Play mode and the share viewer play the same motion.** Both animate with the Web Animations API from the same plans: play mode calls `screenTransition` and `overlayMotion`, and the viewer gets their output as a JSON table, with browser copies of the parsers that a test keeps in step. An animated transition mounts the next screen in a second frame and starts once it has rendered (or after 1 s), so the motion never shows an empty frame. Instant links still reuse one frame.

## Why

- The reasons of 0007 hold: the file is the design, the settings travel with the element through edits and generations, and they show in the diff.
- Attributes keep every link readable on its own. A side table keyed by element would break on the next edit.
- One motion table for both players means the shared link moves the way play mode does.

## Consequences

- The export's hash router ignores both attributes and opens the target screen. The export README says so; a developer replaces the router and keeps or removes them.
- The generation prompt asks models to keep both attributes next to `data-link-to` (`PROMPT_VERSION` 18).
- An animated transition loads a second frame for each step, so it costs one frame boot. That is fine for a prototype and does not touch the canvas.
