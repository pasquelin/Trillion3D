/**
 * A ROW'S INPUTS, as the compose rows pass reads them (`composedRowInputs.ts`): the local box's
 * centre and half extent grown by the reach, the box grown by it, then the detail's — made from a
 * page record and its root, packed as the GPU reads them.
 */
import { boxCenter, boxGrow } from '../../../math/src/geometry/box.ts'
import { packDoubles } from '../../../math/src/float/splitDouble.ts'
import { rowBox, rowGrowth } from '../hiz/corners.ts'
import type { PageRec } from '../page/selection/selection.ts'
import { LOD_FLAGS, ROW_LOD_INPUT_DOUBLES, rowLodInputs } from '../webgpu/shadow/rowLodWords.ts'
import type { Placements } from '../page/selection/placements.ts'

/** A row's inputs: its local box's centre and half extent grown by the reach (the sphere), its box
 *  grown by it (the corners), then the detail's. The centre and half extent are kept beside the
 *  grown box, not derived from it on the GPU: `(min − r + max + r) / 2` is not the double
 *  `(min + max) / 2` the CPU's sphere is made from (`writeClusterSphere`), and the GPU's words are
 *  the CPU's to the bit. */
export const ROW_INPUT_DOUBLES = 12 + ROW_LOD_INPUT_DOUBLES
/** Where each part lies, in doubles: the grown box flat, its low corner then its high one. */
const INPUT_CENTRE = 0,
  INPUT_HALF = 3,
  INPUT_BOX = 6
export const INPUT_LOD = 12

/** A row's box, flat, as the growth by its reach reads it. */
const flat = new Float64Array(6)

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
    flat[axis] = min[axis]
    flat[3 + axis] = max[axis]
  }
  boxGrow(into, o + INPUT_BOX, flat, 0, reach)
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
