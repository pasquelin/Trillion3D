// The per-element loops of the world step (`packages/sdk-browser/src/frame/render/render.ts`), on the root count of the
// reference scene: what a scene change pays in JavaScript — a moving camera pays none, each cut
// reading its translations at its own eye on the GPU —, timed on a nanosecond clock where the engine's
// own `worldMs` bound reads on a 0.1 ms one. This is the measurement a WebAssembly kernel is gated
// on: a loop under 0.1 ms per image keeps its JavaScript form.
import { measure } from '../../core/measure.ts'
import { rapport } from '../../core/report.ts'
import { rootWorlds } from '../../../packages/sdk-browser/src/geometry/dag/pack/packWorlds.ts'
import { changedWorlds } from '../../../packages/sdk-browser/src/geometry/dag/worlds/worlds.ts'
import type { DagRoot } from '../../../packages/sdk-browser/src/geometry/dag/types.ts'

/** Emerald Square, `--scene emerald-square`: 2 479 selection roots (campaign `l-80b`). */
const ROOTS = 2479
// Only `.world.elements` is read here: a fresh, empty-page root, built once outside the timed
// loops below.
const roots: DagRoot[] = Array.from({ length: ROOTS }, (_, i) => ({
  world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i, i * 2, i * 3, 1] },
  pages: [],
}))
const worlds = new Float32Array(ROOTS * 16)
rootWorlds(worlds, roots)
// The previous scene's worlds: the first root turned — the scan lists it, and reads every root.
const previous = worlds.slice()
previous[0] += 0.5
const listed = new Int32Array(ROOTS)

const results = await measure({
  name: 'world step loops',
  fichier: [
    'packages/sdk-browser/src/geometry/dag/pack/packWorlds.ts',
    'packages/sdk-browser/src/geometry/dag/worlds/worlds.ts',
  ],
  cas: [
    {
      name: 'root worlds, 2 479 roots',
      input: () => rootWorlds(worlds, roots),
      size: ROOTS,
    },
    {
      name: 'change scan, first root moved',
      input: () => changedWorlds(previous, worlds, listed),
      size: ROOTS,
    },
    {
      name: 'change scan, nothing moved',
      input: () => changedWorlds(worlds, worlds, listed),
      size: ROOTS,
    },
  ],
  calculation: (loop) => loop(),
  motif:
    'correctness held by packages/sdk-browser/src/camera/renderOrigin.test.ts and packages/sdk-browser/src/gpu/dag/worlds.test.ts; these lines time the loops',
  options: { tours: 500, budgetMs: 1500 },
})

rapport('root-worlds', [results])
