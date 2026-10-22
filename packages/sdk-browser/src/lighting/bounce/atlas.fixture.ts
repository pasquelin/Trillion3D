// A bounce atlas (`atlas.ts`) simulated for the shaders run as JavaScript (`shaderRun`): its texels,
// layer by layer, and the `textureLoad` and `textureStore` the kernels call on it.
import assert from 'node:assert/strict'
import { ATLAS_WIDTH, PROBE_TEXELS } from './atlas.ts'

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
