# 0016 · Screens draw images with `@/components/ui/placeholder`: seeded SVG, no bundled assets

- **Status:** accepted
- **Date:** 2026-10-10
- **Extends:** [0010](./0010-project-images-pushed-to-frames.md), [0014](./0014-uai-blocks-in-screens.md)
- **Code:** [`src/mainview/components/ui/placeholder.tsx`](../../src/mainview/components/ui/placeholder.tsx), [`src/shared/components/ui-modules.ts`](../../src/shared/components/ui-modules.ts), [`src/mainview/runtime/externals.ts`](../../src/mainview/runtime/externals.ts), [`src/bun/ai/prompt.ts`](../../src/bun/ai/prompt.ts)

## Context

Screens can't load network images: frames are sandboxed, and a mockup that depends on a remote host breaks offline, in the share viewer and in exports. Project images in `public/` work ([0010](./0010-project-images-pushed-to-frames.md)), but a new project has none. So generated screens stood in for every photo, avatar, map and chart with an icon or a gradient, and a food app or a travel app looked like a settings page.

## Options

1. **Bundle stock photos** in the runtime. Real photos look best, but a useful set is megabytes, the same few images repeat on every screen, they need licenses, and they ignore the theme.
2. **Generate images with an image model** during a generation. Slow, costs money, needs a provider that has one, and still has to land in `public/`.
3. **Draw them in code**: a UI module that renders SVG from its props.

## Decision

**Option 3.** `Placeholder` is a UI module like a primitive: `import { Placeholder } from "@/components/ui/placeholder"`.

- **API:** `kind` is `photo`, `avatar`, `illustration`, `map` or `chart`. `subject` picks the scene: a photo of a `landscape`, `food`, `interior`, `product`, `people` or `abstract`; an illustration of `tiles`, `empty`, `success` or `error`; an `area`, `line` or `bar` chart. `seed` is any text. `pin` puts a pin on a map, and `label` names the image for screen readers. `className` sizes it; each kind has a default size (`aspect-[4/3] w-full`, `size-10 rounded-full` for an avatar, `h-24 w-full` for a chart). An unknown subject falls back to the kind's default scene.
- **Deterministic:** the same kind, subject and seed always draw the same image, on every engine. A seeded generator (FNV-1a and mulberry32) places every shape, so a screen looks the same on the canvas, in a share link and in an export, and a list of cards gets a different image per seed.
- **Theme:** avatars, illustrations, maps and charts are drawn with the theme variables (`--primary`, `--muted`, `--chart-1` to `--chart-5`, `--success`…), so a DESIGN.md re-themes them and dark mode works. Photos keep their own colors, like real photos. The product photo's studio backdrop takes the primary color.
- **No assets:** only SVG shapes, gradients and a grain filter. About 23 kB minified (7.5 kB gzipped) in the frame runtime. Nothing is fetched.
- **Accessible:** the root is `role="img"` with an `aria-label` from `label`, or from the kind and subject ("Food photo").
- **Exports:** a gradient shape also sets `color` to a flat color, which is what the PNG and PDF snapshot paints for a gradient. Filters (grain, blur) are left out of those exports. The Vite export copies `placeholder.tsx` like any UI module; it imports only React and `cn`.
- **Prompt:** the design rules tell the model to draw images with `Placeholder` and show one example. `PROMPT_VERSION` went to 15.

## Consequences

- Screens get images that read as photos, maps and charts with no network and no new dependency.
- The images are stylized. A user who wants a real photo picks one with the inspector's image picker, which writes it to `public/` ([0010](./0010-project-images-pushed-to-frames.md)).
- A new subject is a new function in `placeholder.tsx` and a word in the prompt. Each one adds to the runtime bundle, so keep the set small.
- Gradient ids include `useId` and the seed, so several placeholders in one frame never share a gradient.
