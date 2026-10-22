/**
 * A ROW'S INPUTS, as the rows pass reads them (`rowWordsWgsl.ts`): the local box's centre and half
 * extent grown by the reach, then the detail's and the bits — made from a page record and its root,
 * packed as the GPU reads them. All of it is what a world does not change: written when the row
 * is, never when its root moves.
 */
import { boxCenter } from '../../../../math/src/geometry/box.ts'
import { packDoubles } from '../../../../math/src/float/splitDouble.ts'
import { rowBox, rowGrowth } from '../../visibility/hiz/corners.ts'
import type { PageRec } from '../../geometry/selection/types.ts'
import {
  LOD_BIT,
  LOD_INPUT,
  ROW_LOD_INPUT_DOUBLES,
  rowLodInputs,
  rowObjectInputs,
} from '../../lighting/shadows/casters/rowLodWords.ts'
import type { ObjectRoot } from '../../lighting/shadows/casters/objectSphere.ts'

/** A row's inputs: its local box's centre and half extent grown by the reach (the sphere), then the
 *  detail's. The centre is the double `(min + max) / 2` the sphere is made from (`rowSphere.ts`). */
export const ROW_INPUT_DOUBLES = 6 + ROW_LOD_INPUT_DOUBLES
/** Where each part lies, in doubles. */
const INPUT_CENTRE = 0,
  INPUT_HALF = 3
export const INPUT_LOD = 6
/** The bits' double, which the shader reads as one integer word. */
export const INPUT_FLAGS = INPUT_LOD + LOD_INPUT.flags

/**
 * Row inputs `rec` of a root `root`, into `into` from `o`; the zero inputs for a row with no record.
 * `lod` false leaves the detail out — a blended caster's row has none, but its object's sphere.
 */
export function rowInputs(
  into: Float64Array,
  o: number,
  rec: PageRec | undefined,
  root: ObjectRoot | undefined,
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
  if (lod) rowLodInputs(into, o + INPUT_LOD, rec, root, ready, childReady)
  else rowObjectInputs(into, o + INPUT_LOD, rec, root)
  into[o + INPUT_FLAGS] = into[o + INPUT_FLAGS] | LOD_BIT.record
}

/** The inputs `scratch` holds, packed at word `base` of `out` as the GPU reads them: each double two
 *  words, but the bits one word, which the shader reads as an integer. */
export function packInputs(out: Uint32Array, base: number, scratch: Float64Array) {
  packDoubles(out, base, scratch)
  const flags = INPUT_FLAGS * 2
  out[base + flags] = scratch[INPUT_FLAGS]
  out[base + flags + 1] = 0
}
