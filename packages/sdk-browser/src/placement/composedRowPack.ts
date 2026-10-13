/**
 * A ROW'S INPUTS, as the compose rows pass reads them (`composedRowInputs.ts`): the local box's
 * centre and half extent grown by the reach, the box grown by it, then the detail's — made from a
 * page record and its root, packed as the GPU reads them.
 */
import { boxCenter } from '../../../math/src/geometry/box.ts'
import { packDoubles } from '../../../math/src/float/splitDouble.ts'
import { rowBox, rowGrowth } from '../hiz/corners.ts'
import type { PageRec } from '../page/selection/selection.ts'
import { LOD_FLAGS, ROW_LOD_INPUT_DOUBLES, rowLodInputs } from '../webgpu/shadow/rowLodWords.ts'
import type { Placements } from '../page/selection/placements.ts'

/** A row's inputs: its local box's centre and half extent grown by the reach (the sphere), its box
 *  grown by it (the corners), then the detail's. */
export const ROW_INPUT_DOUBLES = 12 + ROW_LOD_INPUT_DOUBLES
/** Where each part lies, in doubles. */
const INPUT_CENTRE = 0,
  INPUT_HALF = 3,
  INPUT_MIN = 6,
  INPUT_MAX = 9
export const INPUT_LOD = 12

/**
 * Row inputs `rec` of a root `root`, into `into` from `o`; the zero inputs for a row with no record.
 * `lod` false leaves the detail out — a blended caster's row has none.
 */
export function rowInputs(
  into: Float64Array,
  o: number,
  rec: PageRec | undefined,
  root: (Placements[number] & { readonly worldBox?: ArrayLike<number> }) | undefined,
  ready: boolean,
  childReady: boolean,
  lod = true,
) {
  into.fill(0, o, o + ROW_INPUT_DOUBLES)
  if (!rec || !root) return
  const { min, max } = rowBox(rec),
    reach = rowGrowth(rec, root.reach)
  boxCenter(into, o + INPUT_CENTRE, min[0], min[1], min[2], max[0], max[1], max[2])
  for (let axis = 0; axis < 3; axis++) {
    into[o + INPUT_HALF + axis] = (max[axis] - min[axis]) / 2 + reach
    into[o + INPUT_MIN + axis] = min[axis] - reach
    into[o + INPUT_MAX + axis] = max[axis] + reach
  }
  if (lod) rowLodInputs(into, o + INPUT_LOD, rec, root, ready, childReady)
}

/** The inputs `scratch` holds, packed at word `base` of `out` as the GPU reads them: each double two
 *  words, but the detail's bits one word, which the shader reads as an integer. */
export function packInputs(out: Uint32Array, base: number, scratch: Float64Array) {
  packDoubles(out, base, scratch)
  const flags = (INPUT_LOD + LOD_FLAGS) * 2
  out[base + flags] = scratch[INPUT_LOD + LOD_FLAGS]
  out[base + flags + 1] = 0
}
