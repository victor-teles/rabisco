# 0026 · Component overrides live at the call site

- **Status:** proposed
- **Date:** 2026-10-11
- **Extends:** [0006](./0006-components-from-source.md)

## Context

Phase 26 brings Figma's main component and instance model to the canvas. In Figma, an instance can change text, fills and nested layers, and the main component still updates the rest. In Rabisco a component is a TSX file and a usage is a JSX element in a screen ([0006](./0006-components-from-source.md)). A usage can differ from its component only through the props the component declares. "Make component" turns text and string attributes that differ into props, and the component doesn't take a `className` (`src/shared/jsx/extract.ts`).

So an override needs a home in the source. It must read like code a developer would write, survive a generation that rewrites the file, and be easy to reset.

## Options

1. **Every override is a prop.** Changing a value on one usage adds a prop to the component, with the old value as its default, and passes the new value at the call site. Clean code, but each style change grows the component's API.
2. **Overrides are a `className` at the call site.** Components take `className` and merge it on their root with `cn()`, as shadcn components do. Style overrides become classes on the usage. Text and nested elements still need props.
3. **Overrides are a side table in `rabisco.json`.** Keyed by usage and element path. Nothing changes in the TSX, but the design is no longer the file, and a generation breaks the keys.
4. **No overrides, only detach.** A usage either follows the component or becomes plain JSX.

## Proposed decision

**Options 1 and 2 together, by kind of change, with detach as the way out.**

- **Text and string attributes** on an element inside a usage become a prop, as "Make component" does today. The component keeps the old value as the default, so other usages don't change.
- **Classes on the usage's root** go in `className` at the call site. Rabisco components take `className` and merge it with `cn()` on their root. "Make component" writes this from now on, and a component that lacks it gets it the first time a usage needs it.
- **Classes on a nested element** become a prop named for the element (`iconClassName`), merged the same way. This is the one case that grows the API, so the inspector says so before it writes.
- **Reset** removes the call-site props and `className` that differ from the component's defaults. **Apply to component** moves them into the component and removes them from the usage, for every usage.
- **Detach** replaces the usage with the component's JSX, props filled in, and imports adjusted.
- **Editing from a usage** writes to the component file. Selecting an element inside a usage resolves its `data-rabisco-loc` to the component file, not the screen.

## Open questions

- Which gesture steps inside a usage. Double-click edits text today, and Enter edits text on an element without children.
- How the inspector shows which fields are overridden, and whether it shows a component default next to the usage value.
- Whether shadcn components count as instances. They take `className` already, but they live in the runtime bundle, so "edit the component" can't apply to them.
- How `Apply to component` handles a `className` that conflicts with the root's classes. `tailwind-merge` decides at run time; the write must decide in the source.

## Consequences

- Components grow a `className` prop and, sometimes, element class props. The generation prompt must keep them, so `PROMPT_VERSION` goes up.
- The export needs no change. Overrides are plain props.
