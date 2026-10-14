# 0039 · Copy to Figma writes Figma's own clipboard buffer from the rendered screen, named from the source; a round trip through our reader checks it

- **Status:** accepted
- **Date:** 2026-10-13
- **Extends:** [0006](./0006-components-from-source.md), [0010](./0010-project-images-pushed-to-frames.md), [0035](./0035-imports-become-one-captured-tree.md)

## Context

Phase 24 asks for "Copy to Figma". A designer selects screens in Rabisco, copies them and pastes them into Figma. They must get Figma layers with auto layout, editable text and images, with no manual fixes.

Rabisco already reads the other direction ([0035](./0035-imports-become-one-captured-tree.md)). Figma writes `text/html` with a `(figmeta)` comment that holds JSON and a `(figma)` comment that holds a base64 `fig-kiwi` buffer: a header, a version, a deflate or zstd Kiwi schema and a Kiwi message of `NodeChange` records. `src/shared/import/figma/` decodes it. `figma-fixture.ts` already encodes the same format for tests.

Two things already capture a rendered screen:

- **The export scene** (`src/shared/export/scene.ts`, `src/mainview/runtime/snapshot.ts`) is a flat list of paint ops: fills, borders, shadows, text runs, images and paths. It is right for PNG, SVG and PDF. It has no tree and no layout, so it can't give auto layout.
- **The capture script** (`src/shared/import/capture-script.ts`) walks a DOM into a `CapturedNode` tree: tag, box, resolved layout and type styles, images and children. HTML paste and URL capture use it.

These rules stay: screens are sandboxed, components come from source ([0006](./0006-components-from-source.md)), and the app works with no account and no AI.

## Options

### Clipboard format

| Format                                 | Auto layout | Text                       | Images                     | Components and variables | Stability                                 |
| -------------------------------------- | ----------- | -------------------------- | -------------------------- | ------------------------ | ----------------------------------------- |
| Figma's buffer in `text/html`          | yes         | editable, with styles      | yes, if bytes ride along   | possible                 | unofficial; the version field can change  |
| SVG                                    | no          | text layers, no wrap width | yes, as embedded data URLs | no                       | stable; Figma's SVG import rarely changes |
| HTML or JSON that a Figma plugin reads | yes         | editable, with styles      | yes                        | yes, through the API     | stable plugin API                         |

A plugin is the most stable, but the user must find it, install it, run it and paste into its window each time. That is a manual step on every copy. SVG gives the right picture with no structure: every frame is a group, nothing reflows, and a designer must rebuild the layout. That fails "no manual fixes".

### Source of the layers

1. **The TSX source.** It has components, names and `.map` lists. It doesn't know sizes, wrapping, resolved tokens or what a `cva` variant looks like. We would have to reimplement CSS layout.
2. **The rendered DOM.** It is what the user sees, with computed layout. It doesn't know which elements are one component.
3. **Both.** Geometry and styles from the rendered DOM. Names and component boundaries from the source, through the `data-rabisco-loc` attribute the compiler already adds and the fiber walk in `src/mainview/runtime/inspect.ts`.

## Decision

**Write Figma's own clipboard buffer.** Build the layers from the rendered DOM with the capture script, and name them from the source (option 3). Check the result by reading it back with our own Figma reader.

### Where it runs

1. **In the screen frame.** The frame gets a `capture` message and runs the capture script on its own document. It is the same code as HTML paste, with two additions: it keeps `data-rabisco-loc` and the component name from the fiber walk on each node, and it reads images as bytes (the frame already holds project images as bytes, [0010](./0010-project-images-pushed-to-frames.md)). The frame posts back data only, parsed and capped like every `CapturedNode` tree. The frame stays sandboxed and the app never runs screen code.
2. **In a Web Worker in the webview.** A pure function in `src/shared/export/figma/` turns the trees into `NodeChange` records and encodes the buffer. The encoder grows out of `figma-fixture.ts`, which moves out of test code.
3. **On the clipboard.** The command writes `text/html` with the `(figmeta)` and `(figma)` comments from a native copy event, the way Figma does. It also writes `text/plain` with the screen names. No RPC, no network, no provider, no account.

The command is **Copy to Figma**, `⌃⌘C`, in the screen menu and the Export popover. It copies the selected screens. Each screen becomes a top-level frame, placed as on the canvas, named after the screen. It copies the screen as it is rendered now: its width, theme and state.

### The schema

Kiwi messages carry their own schema, but Figma's paste may expect fields it always writes. So the encoder uses Figma's real schema, not our short test schema. A real Figma copy, captured once by a person, is checked in as a fixture. The encoder writes its schema chunk and only the fields we need. A test checks that every field we write exists in that schema with the same type. When Figma changes the version, we capture a new fixture and run the same tests.

### Layers from the tree

| Rendered DOM                                                        | Figma                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `display: flex`, `row` or `column`                                  | Auto layout, horizontal or vertical. `-reverse` reverses the child order                            |
| `gap`, `padding`                                                    | Spacing between items, padding                                                                      |
| `flex-wrap: wrap`                                                   | Wrap, with `row-gap` as the spacing between rows                                                    |
| `justify-content`: start, center, end, `space-between`              | Primary alignment: min, center, max, space between                                                  |
| `justify-content`: `space-around`, `space-evenly`                   | Space between, with padding equal to the measured outer space                                       |
| `align-items`: start, center, end, baseline; `stretch`              | Counter alignment; stretch makes each child fill the cross axis                                     |
| `flex-grow` above 0                                                 | The child fills the primary axis                                                                    |
| A box that equals its content plus padding, within 1 px             | Hug                                                                                                 |
| A block that fills its parent's content box                         | Fill                                                                                                |
| Any other size                                                      | Fixed                                                                                               |
| Block flow (stacked `display: block` children)                      | Vertical auto layout when the space between children is the same; the space becomes the spacing     |
| `display: grid` where all items share one track size and none spans | Horizontal auto layout with wrap and fixed item widths. It reflows like `grid-cols-N` at that width |
| `position: absolute` or `fixed` in a flex parent                    | An absolute child of the auto layout frame, with constraints from `top`/`right`/`bottom`/`left`     |
| `overflow: hidden`, `opacity`, `transform`                          | Clip content, layer opacity, layer transform                                                        |
| Background color and linear or radial gradient                      | Solid or gradient fill                                                                              |
| `background-image`, `<img>` with `object-fit`                       | Image fill, with fill, fit or crop from `object-fit` and `background-size`                          |
| Borders                                                             | Inside strokes, with a weight per side when the sides differ                                        |
| `box-shadow`, `inset`, rings                                        | Drop shadow and inner shadow effects                                                                |
| Inline `svg` (icons)                                                | Vector layers from the path data                                                                    |
| A text node and its inline elements                                 | One text layer. Bold, color and decoration on inline runs become style overrides                    |

**Layouts with no auto layout equivalent** (grids with spans or mixed tracks, varying block margins, inline-block runs, floats, negative margins, overlapping siblings) become a frame with absolute children at their rendered boxes. They look right but don't reflow. The copy toast says how many: "Copied 2 screens to Figma. 3 layouts kept as fixed positions." Figma's own grid auto layout waits until its schema is stable in real copies.

**Text** keeps family, size, weight, style, line height, letter spacing, alignment, case and decoration. Its width follows the box: hug for a single line that fits its content, fixed width with auto height for wrapped text, truncate for `line-clamp` and `text-overflow: ellipsis`. A font that Figma doesn't have shows Figma's missing font notice. The layer stays editable.

**Images** ride in the buffer: the bytes go into the message's `blobs`, and the paint names them by SHA-1 hash. Placeholders from [0016](./0016-image-placeholders.md) are SVG, so they become vectors.

**Names** come from the source. A node whose location is the root of a project component is named after the component (`PricingCard`). Other nodes are named from their semantic tag or text (`nav`, `button "Sign up"`), not `div`. Text layers are named after their text, as Figma does.

### Tokens and components

**First release: raw values, named layers.** Colors are exact hex values. Each frame that is a component usage is a plain frame named after the component.

**Second step: color variables.** Figma's clipboard already carries `VARIABLE` nodes; our reader reads them. A fill that came from a token is bound to a variable with the token's name (`color-primary` becomes `color/primary`), and the variable nodes go into the buffer. This ships only if a paste into a new file creates the variables. Otherwise it waits for a token export that Figma imports ("Export tokens" in Phase 24).

**Later: components.** Project components become a main component next to the screens, with instances where they are used, and `cva` variants become a component set. This needs instance overrides to match [0026](./0026-component-overrides-in-source.md), so it gets its own record. Text styles and effect styles wait with it.

### Fidelity check

**Round trip, with no person.** `bun test` runs fixture trees through the encoder, then through `readFigmaClipboard` and `to-captured.ts`, and compares the result with the input:

- the same tree shape and layer names,
- every box within 1 px,
- the same text, fonts and colors,
- the same auto layout fields: direction, spacing, padding, alignment, wrap and sizing.

The fixture trees are captured from real screens in the app (a dashboard, a form, a landing page, a settings page and a mobile list), stored as JSON next to the tests. Mapping tests cover each row of the table above. The schema test checks every written field against the real Figma fixture.

The round trip proves we write what we mean. It can't prove that Figma accepts it. So two steps need a person, and QA owns them:

1. **A spike before the build.** One hand-made buffer with a frame, an auto layout row, a text layer, an image fill and an icon, pasted into Figma. It must confirm the schema approach, image bytes in `blobs` and vector paths. If images or vectors fail, they fall back to a 2x image fill, and the build issue says so.
2. **An acceptance pass** on the five fixture screens at release, and again when the fixture version changes.

**The bar for "no manual fixes"**, on the five fixture screens pasted into a new Figma file:

- Every text is a text layer, with the right font, size, weight, line height and wrap.
- Every layer is within 1 px of the rendered screen, and the colors are exact.
- Every flex container is auto layout with the right settings. Resizing the root frame to another width reflows like the browser for flex layouts.
- Every image is there, at the right size and crop.
- Layers have names a designer would keep. No `div`, `Frame 12` or `Group 3`.

Fixed positions are allowed only for the layouts listed above, and the toast counts them.

## What ships first, and what waits

**First release ([LIT-43](/LIT/issues/LIT-43)):** the spike, then Copy to Figma for selected screens. Figma's buffer, auto layout from flex, block flow and simple grids, editable text with inline overrides, images, icons as vectors, names from the source, raw color values. The round trip and schema tests, and the QA acceptance pass.

**Waits:**

- Color variables (second step, after the spike shows a paste creates them).
- Figma components, instances and variants; text and effect styles (own record).
- Figma grid auto layout.
- Copying a selected element instead of a screen. The capture works on any subtree, so this needs no new decision.
- Hover, focus and other states. The copy is the screen as it is rendered.

## Consequences

- The format is unofficial. A Figma update can break paste without warning. The checked-in schema, the version test and the QA pass make it quick to see and fix. Our Figma reader has the same risk, so one fixture refresh fixes both directions.
- The encoder and the reader share one schema fixture and one set of field names in `src/shared/import/figma/` and `src/shared/export/figma/`.
- HTML paste and Copy to Figma share the capture script. A change to it must keep both test suites green.
- Copy as SVG (Phase 24, "Copy an element as code, as PNG and as SVG") stays the stable fallback when the buffer fails. It gives the right picture with no structure.
- Most work and tests are in pure functions that run in `bun test` with no browser and no Figma.

## Open questions

- **Shortcut.** `⌃⌘C` is free in Rabisco and has no Figma meaning. Figma's `⇧⌘C` is "Copy as PNG", which Rabisco may want for that item later.
- **Very large copies.** Figma handles big pastes, but a 30-screen copy with images may pass the reader's 40 MB cap. The first release copies up to that cap and says so when a selection is larger.
