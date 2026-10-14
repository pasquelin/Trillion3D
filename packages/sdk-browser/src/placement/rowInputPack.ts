/**
 * A ROW'S INPUTS, as the rows pass reads them (`rowWordsWgsl.ts`): the local box's centre and half
 * extent grown by the reach, the box grown by it, then the detail's and the bits — made from a
 * page record and its root, packed as the GPU reads them. All of it is what a world does not
 * change: written when the row is, never when its root moves.
 */
import { boxCenter, boxGrow } from '../../../math/src/geometry/box.ts'
import { packDoubles } from '../../../math/src/float/splitDouble.ts'
import { rowBox, rowGrowth } from '../hiz/corners.ts'
import type { PageRec } from '../page/selection/types.ts'
import { LOD_INPUT, ROW_LOD_INPUT_DOUBLES, rowLodInputs } from '../webgpu/shadow/rowLodWords.ts'
import type { Placements } from '../page/selection/placements.ts'
import type { WorldMemo } from '../page/selection/rootWorld.ts'

/** A row's inputs: its local box's centre and half extent grown by the reach (the sphere), its box
 *  grown by it (the corners), then the detail's. The centre and half extent are kept beside the
 *  grown box, not derived from it on the GPU: `(min − r + max + r) / 2` is not the double
 *  `(min + max) / 2` the sphere is made from (`rowSphere.ts`). */
export const ROW_INPUT_DOUBLES = 12 + ROW_LOD_INPUT_DOUBLES
/** Where each part lies, in doubles: the grown box flat, its low corner then its high one. */
const INPUT_CENTRE = 0,
  INPUT_HALF = 3,
  INPUT_BOX = 6
export const INPUT_LOD = 12
/** The bits' double, which the shader reads as one integer word. */
export const INPUT_FLAGS = INPUT_LOD + LOD_INPUT.flags
/** The bit of the flags word a row holding a page sets: a row without one has every derived word
 *  zero — its sphere, its corners — and its detail drawn by every page. */
export const ROW_HAS_RECORD = 32

/** A row's box, flat, as the growth by its reach reads it. */
const flat = new Float64Array(6)

/** The box of page `rec` grown by its reach under a root of reach `rootReach` (`rowGrowth`), flat —
 *  its low corner then its high one — into `into` from `o`: what its eight Hi-Z corners are made of,
 *  a row's (`rowInputs`) and a transparent entry's (`../webgpu/transparent/entryCorners.ts`). */
export function grownRowBox(into: Float64Array, o: number, rec: PageRec, rootReach?: number) {
  const { min, max } = rowBox(rec)
  growInto(into, o, min, max, rowGrowth(rec, rootReach))
}

/** The box `min`–`max` grown by `reach`, flat, into `into` from `o`. */
function growInto(
  into: Float64Array,
  o: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  reach: number,
) {
  for (let axis = 0; axis < 3; axis++) {
    flat[axis] = min[axis]
    flat[3 + axis] = max[axis]
  }
  boxGrow(into, o, flat, 0, reach)
}

/**
 * Row inputs `rec` of a root `root`, into `into` from `o`; the zero inputs for a row with no record.
 * `lod` false leaves the detail out — a blended caster's row has none.
 */
export function rowInputs(
  into: Float64Array,
  o: number,
  rec: PageRec | undefined,
  root: (Placements[number] & WorldMemo) | undefined,
  ready: boolean,
  childReady: boolean,
  lod = true,
) {
  into.fill(0, o, o + ROW_INPUT_DOUBLES)
  if (!rec || !root) return
  const { min, max } = rowBox(rec),
    reach = rowGrowth(rec, root.reach)
  boxCenter(into, o + INPUT_CENTRE, min[0], min[1], min[2], max[0], max[1], max[2])
  for (let axis = 0; axis < 3; axis++)
    into[o + INPUT_HALF + axis] = (max[axis] - min[axis]) / 2 + reach
  growInto(into, o + INPUT_BOX, min, max, reach)
  if (lod) rowLodInputs(into, o + INPUT_LOD, rec, root, ready, childReady)
  into[o + INPUT_FLAGS] += ROW_HAS_RECORD
}

/** The inputs `scratch` holds, packed at word `base` of `out` as the GPU reads them: each double two
 *  words, but the bits one word, which the shader reads as an integer. */
export function packInputs(out: Uint32Array, base: number, scratch: Float64Array) {
  packDoubles(out, base, scratch)
  const flags = INPUT_FLAGS * 2
  out[base + flags] = scratch[INPUT_FLAGS]
  out[base + flags + 1] = 0
}
