# 0046 · Link timing, triggers and actions are more attributes on the element

- **Status:** proposed
- **Date:** 2026-10-15
- **Extends:** [0007](./0007-prototype-links-in-source.md), [0022](./0022-link-transitions-and-overlays.md)
- **Code:** [`src/shared/prototype/links.ts`](../../src/shared/prototype/links.ts), [`src/shared/prototype/transitions.ts`](../../src/shared/prototype/transitions.ts), [`src/mainview/runtime/play.ts`](../../src/mainview/runtime/play.ts), [`src/mainview/views/editor/link-control.tsx`](../../src/mainview/views/editor/link-control.tsx)

## Context

Phase 26 draws links on the canvas and asks for the rest of Figma's prototype settings: a duration and an easing for the transition, triggers other than a click, and actions other than going to a screen. Decisions 0007 and 0022 keep a link in the TSX as `data-link-to`, `data-link-transition` and `data-link-mode`. The new settings belong to the same link.

## Decision

**Each setting is one more `data-link-*` attribute, or a new kind of `data-link-to` value.** The rules of 0007 and 0022 hold: only string literals count, reading is forgiving, unknown values count as not written, the attributes work on components and play mode reads them from React's fiber chain.

```tsx
<Button data-link-to="screens/profile.tsx" data-link-transition="push" data-link-duration="200" data-link-easing="ease-out">
<Card data-link-to="screens/details.tsx" data-link-trigger="hover">
<div data-link-to="screens/home.tsx" data-link-trigger="after 2000ms">
<Button data-link-to="screens/next.tsx" data-link-trigger="key ArrowRight">
<a data-link-to="#pricing">Pricing</a>
<a data-link-to="https://example.com/docs">Docs</a>
```

### Timing

- **`data-link-duration`** is milliseconds: `200`, `200ms` or `0.2s`, from 0 to 5000.
- **`data-link-easing`** is `linear`, `ease-in`, `ease-out` or `ease-in-out`, with Tailwind's curves.
- **Without them, a transition uses the motion defaults** in `transitions.ts` (300 ms and a standard curve). When DESIGN.md has motion tokens ([0027](./0027-motion-in-source.md)), those tokens become the defaults; the attributes keep their meaning.
- **Back plays the reverse with the same timing**, as it does with the transition.
- The share viewer applies the timing to the plans in its motion table, so it moves like play mode.

### Triggers

- **`data-link-trigger`** is `click` (the default), `hover` (the pointer enters the element), `press` (the pointer goes down on it), `after <time>` (that long after the screen shows) or `key <key>` (a key press while the screen shows, with `KeyboardEvent.key` names: `key Enter`, `key ArrowRight`, `key k`).
- **The frame runs the triggers.** It already catches clicks in play mode, so it also listens for pointer-enter, pointer-down and keys, and starts a timer for `after` links when it renders a screen. It posts the same `navigate` message for all of them. A `press` link takes the click that follows, so the link fires once.
- **The play view forwards keys to the frame** while the frame doesn't have focus, so a `key` link works without a click into the screen first. Play mode's own keys (Esc, ⌘[ and ⌘]) win.
- **The canvas shows the trigger** in the connector's popover and the inspector. It doesn't draw it on the connector.

### Actions

- **`data-link-to="#id"` scrolls to an element.** The frame scrolls the element with that `id` into view, smoothly, without leaving the screen. It doesn't post `navigate`. The inspector lists the literal `id`s of the screen.
- **`data-link-to="https://…"` opens a URL.** Also `http:` and `mailto:`. Play mode opens web links in the system browser and shows the address of a `mailto:` link, since the app opens only web links; the share viewer opens both in a new tab. The canvas draws a stub labeled with the host, like a Back stub.
- **Switching a component's variant is not part of this decision.** A variant is a prop at the call site, and the frame can't change a prop of a rendered component without state the screen doesn't have. That needs its own decision (a frame-side override keyed by element, or a generated `useState`).

## Why

- The reasons of 0007 and 0022 hold: the file is the design, and the settings move with the element through edits and generations.
- One attribute per setting keeps each link readable alone, and the common case stays one attribute.
- `after 800ms` and `key Enter` read as English and keep a trigger to one attribute.
- A `#id` or a URL is what a developer would write in an `href`, so the export can map them to anchors without a side table.

## Consequences

- The export's router ignores the new attributes. `#id` and URL links still work when the element is an `<a>` with the same `href`.
- The generation prompt asks models to keep every `data-link-*` attribute.
- Delay timers restart when a screen shows again, as in Figma.
- `key` links listen only while their screen shows. Two links on the same key: the first in source order wins.
