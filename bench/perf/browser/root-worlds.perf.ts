// The per-element loops of the world step (`packages/sdk-browser/src/webgpu/pages/render/render.ts`), on the root count of the
// reference scene: what a scene change pays in JavaScript — a moving camera pays none, each cut
// reading its translations at its own eye on the GPU —, timed on a nanosecond clock where the engine's
// own `worldMs` bound reads on a 0.1 ms one. This is the measurement a WebAssembly kernel is gated
// on: a loop under 0.1 ms per image keeps its JavaScript form.
import * as THREE from 'three'
import { measure, rapport } from '../../core/index.ts'
import { rootWorlds } from '../../../packages/sdk-browser/src/gpu/dag/pack.ts'
import {
  changedWorlds,
  refreshMovedStretch,
} from '../../../packages/sdk-browser/src/gpu/dag/worlds.ts'
import type { DagRoot } from '../../../packages/sdk-browser/src/gpu/dag/types.ts'

/** Emerald Square, `--scene emerald-square`: 2 479 selection roots (campaign `l-80b`). */
const ROOTS = 2479
// Only `.world.elements` is read here: a fresh, empty-page root, built once outside the timed
// loops below.
const roots: DagRoot[] = Array.from({ length: ROOTS }, (_, i) => ({
  world: new THREE.Matrix4().fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i, i * 2, i * 3, 1]),
  pages: [],
}))
const worlds = new Float32Array(ROOTS * 16)
rootWorlds(worlds, roots)
// The previous scene's worlds: the first root turned — the scan lists it, and reads every root.
const previous = worlds.slice()
previous[0] += 0.5
const listed = new Int32Array(ROOTS),
  everyRoot = Int32Array.from({ length: ROOTS }, (_, i) => i),
  stretched = new Int32Array(ROOTS)
const packed = { worldStretch: new Float32Array(ROOTS) }
const frameData = new Float32Array(ROOTS * 7 * 4)

const results = await measure({
  name: 'world step loops',
  fichier: [
    'packages/sdk-browser/src/gpu/dag/pack.ts',
    'packages/sdk-browser/src/gpu/dag/worlds.ts',
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
    {
      name: 'stretch scan, a root turned',
      input: () =>
        refreshMovedStretch(previous, worlds, packed, frameData, everyRoot, ROOTS, stretched),
      size: ROOTS,
    },
  ],
  calculation: (loop) => loop(),
  motif:
    'correctness held by packages/sdk-browser/src/camera/renderOrigin.test.ts and packages/sdk-browser/src/gpu/dag/worlds.test.ts; these lines time the loops',
  options: { tours: 500, budgetMs: 1500 },
})

rapport('root-worlds', [results])
