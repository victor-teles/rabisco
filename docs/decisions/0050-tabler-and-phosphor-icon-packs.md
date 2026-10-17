# 0050 · Screens can import Tabler and Phosphor icons, loaded one script per icon like lucide

- **Status:** proposed
- **Date:** 2026-10-17
- **Extends:** [0001](./0001-compile-tsx-in-the-webview.md), [0003](./0003-ai-provider-contract.md), [0047](./0047-fonts-in-public-and-images-from-providers.md)
- **Code:** [`src/shared/icons.ts`](../../src/shared/icons.ts), [`src/mainview/runtime/icons.ts`](../../src/mainview/runtime/icons.ts), [`vite.runtime.config.ts`](../../vite.runtime.config.ts), [`src/shared/jsx/icons.ts`](../../src/shared/jsx/icons.ts), [`src/mainview/lib/icon-catalog.ts`](../../src/mainview/lib/icon-catalog.ts)

## Context

Screens could import icons only from `lucide-react`. Teams that design with Tabler or Phosphor had to redraw their icons or accept lucide's look. Phase 25 left "icon packs besides lucide" open.

The frame runtime does not carry lucide. The build writes one classic script per icon (`icons/<name>.js`), and the frame loads only the icons a screen imports, before it renders. Share links copy the scripts they need. No decision recorded this design.

## Options

| Option                                   | Fits the per-icon loading                                      | Cost                                                  |
| ---------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| Bundle the pack's React package          | no: every frame parses the whole pack                          | megabytes of script in every frame                    |
| Heroicons, Radix icons                   | yes                                                            | small sets; most teams that leave lucide go elsewhere |
| **Tabler and Phosphor, from their data** | yes: Tabler ships node arrays, Phosphor ships one SVG a weight | 2.2 MB and 4.3 MB of icon scripts in the app          |

## Decision

**`@tabler/icons-react` and `@phosphor-icons/react` are import sources for screens, next to `lucide-react`. Their icons load through the same per-icon scripts, and they render with the same props as the real packages.**

1. **One list.** `ICON_PACKS` in `src/shared/icons.ts` names each pack's module. It also holds the rules that turn an export name into its icon: `IconHome` and `IconHomeFilled` (Tabler), `House` and `HouseIcon` (Phosphor), `Home`, `HomeIcon` and `LucideHome` (lucide). Compile, the runtime, the share viewer, the inspector, the assets panel and validation all read it.
2. **Scripts.** The runtime build writes `icons/tabler/<name>.js` with both Tabler styles of an icon, from `@tabler/icons`. It writes `icons/phosphor/<name>.js` with all six weights, from the SVGs in `@phosphor-icons/core`. The file name comes from the export name (`IconAB2` → `tabler/a-b2`), so the frame finds the file without a manifest. Lucide's scripts keep their paths.
3. **Specs.** A compiled module lists its icons as specs: lucide's by name (`Star`), the others as `<module>:<name>`. Older share snapshots stay valid.
4. **Rendering.** The frame builds each icon from the script's nodes and follows the package's props. Tabler takes `size`, `color`, `stroke` (the stroke width) and `title`, has the `tabler-icon tabler-icon-<name>` class, and its `…Filled` exports are filled. Phosphor takes `size` (default `1em`), `color`, `weight`, `mirrored` and `alt`, and has a working `IconContext`. A component's display name is its export name, so Copy to Figma names its layers `IconHome`.
5. **Generation.** The prompt keeps lucide as the default. When DESIGN.md or the existing screens use Tabler or Phosphor, the model uses that pack, one pack per project. Validation allows the two modules.
6. **Editing.** The inspector's icon picker has a pack switch. Picking an icon from another pack moves the element to that pack's import. The catalogs load lazily, one chunk per pack, so the editor bundle doesn't grow. The assets panel counts icons by pack and name.
7. **Exports.** The code export adds `@tabler/icons-react` and `@phosphor-icons/react` to `package.json` when screens import them. HTML, image and Figma exports already draw the inline SVG.

## Consequences

- The app grows by about 6.5 MB of icon scripts (5,184 Tabler and 1,530 Phosphor files). A frame loads only the icons its screen imports.
- The pack versions are pinned twice: the data packages the build reads, and the versions the code export writes. Upgrade them together, or the export can reference an icon the canvas doesn't have.
- Phosphor's deprecated aliases load like their current names. Tabler's and Phosphor's icon search in the picker matches names, not tags.
