// A bounce atlas (`atlas.ts`) simulated for the shaders run as JavaScript (`shaderRun`): its texels,
// layer by layer, and the `textureLoad` and `textureStore` the kernels call on it.
import assert from 'node:assert/strict'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { ATLAS_WIDTH, PROBE_TEXELS, probeAtlasExtent } from './atlas.ts'

/** Probes along a row of the pool's layer, as the atlas lays them (`ATLAS_WIDTH` texels of `PROBE_TEXELS`). */
export const POOL_ROW_PROBES = ATLAS_WIDTH / PROBE_TEXELS

/** A simulated atlas: its extent and its texels, row by row, layer by layer. */
type SimulatedAtlas = { width: number; height: number; layers: number; texels: number[][] }

/** An atlas of `extent` (width, height, layers), each texel `fill()`ed. */
export const simulatedAtlas = (
  [width, height, layers]: readonly number[],
  fill: () => number,
): SimulatedAtlas => ({
  width,
  height,
  layers,
  texels: Array.from({ length: width * height * layers }, () => [fill(), fill(), fill(), fill()]),
})

/** The rank of texel `(x, y)` of `layer` in `a`, every texel asked of it inside its extent. */
function texelOf(a: SimulatedAtlas, at: ArrayLike<number>, layer: number) {
  const x = at[0],
    y = at[1]
  assert.ok(x < a.width && y < a.height && layer < a.layers, 'in the atlas')
  return (layer * a.height + y) * a.width + x
}

/** The texture calls of a scope over simulated atlases, the atlas their first argument. */
export const ATLAS_CALLS = {
  textureLoad: (a: SimulatedAtlas, at: ArrayLike<number>, layer: number) => [
    ...a.texels[texelOf(a, at, layer)],
  ],
  textureStore: (a: SimulatedAtlas, at: ArrayLike<number>, layer: number, value: number[]) =>
    void (a.texels[texelOf(a, at, layer)] = [...value]),
}

/** The cells of the finest level round the point `(0.3, 0.4, 0.2)`: the eight of a cube, `[-1, -1, -1]` the first. */
export const CORNER_CELLS = Array.from({ length: 8 }, (_, k) => [
  -1 + (k & 1),
  -1 + ((k >> 1) & 1),
  -1 + (k >> 2),
])

/** The levels' uniform a world of one level (`cells` a side, one metre a cell, its lowest cell `-cells / 2`) puts in the shaders' scope. */
export const oneLevel = (cells = 48) => ({
  counts: [cells, 1, cells ** 3, BOUNCE_SETTINGS.probePool],
  levels: [{ base: [-cells / 2, -cells / 2, -cells / 2], spacing: 1 }],
})

/** A probes' atlas of one level (`oneLevel`) in which the probe of slot `k` holds `cells[k]` — its table entry, its cell and its level
 *  written, the slot named plus one — and nothing else. */
export function cellProbes(cells: number[][], side = 48) {
  const atlas = simulatedAtlas(probeAtlasExtent(BOUNCE_SETTINGS.probePool, 4 * side ** 3), () => 0)
  const wrap = (v: number) => ((v % side) + side) % side
  cells.forEach((cell, k) => {
    const entry = (wrap(cell[2]) * side + wrap(cell[1])) * side + wrap(cell[0])
    const texel = Math.floor(entry / 4)
    const table =
      (atlas.height + Math.floor(texel / ATLAS_WIDTH)) * atlas.width + (texel % ATLAS_WIDTH)
    atlas.texels[table][entry % 4] = k + 1
    const first = (k >> 7) * atlas.width + (k & 127) * PROBE_TEXELS
    cell.forEach((c, axis) => (atlas.texels[first + 3 + axis][3] = c))
    atlas.texels[first + 7][3] = 0
  })
  return atlas
}
