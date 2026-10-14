/**
 * A HISTOGRAM'S SUNS, AND WHETHER AN ASK REPEATS THE LAST (`rowBinsParams.ts`): a sun is binned along
 * its clipmap's light-space x and y about its reference split as the spheres are; an ask whose
 * inputs all equal those of the last histogram encoded would bin the same words, and is not made.
 */
import { sameValues } from '../../../math/src/matrix/matrixElements.ts'
import { writeSplitDouble } from '../../../math/src/float/splitDouble.ts'
import type { VsmClipmap } from './clipmap.ts'
import type { RowBinsTag } from './rowBinsRecord.ts'
import type { VsmRowSpheres } from './rowPageBound.ts'

/** The world directions of a clipmap's light-space x and y axes, into `out`. */
export const sunAxes = (m: ArrayLike<number>, out: Float64Array) => {
  for (let k = 0; k < 3; k++) {
    out[k] = m[k * 4]
    out[3 + k] = m[k * 4 + 1]
  }
  return out
}

/** `origin` split as the spheres are, into `out`: high f32, then the rest as an f32. */
export function splitRef(origin: ArrayLike<number>, out: Float32Array) {
  for (let k = 0; k < 3; k++) writeSplitDouble(out, k, 3 + k, origin[k])
  return out
}

/** A sun's axes and reference this frame, before they are known to differ from the last ask's. */
const sunNow = { axes: new Float64Array(6), ref: new Float32Array(6) }

/** Whether `asked` — the last histogram encoded (`RowBins.asked`) — was asked with these very
 *  inputs: the same spheres, rows, motion sums and margin, lamps' keys, and suns along the same axes
 *  about the same reference. Its histogram then is the one this ask would bin. */
export function sameAsk(
  asked: RowBinsTag | undefined,
  spheres: VsmRowSpheres,
  range: { first: number; end: number },
  margin: number,
  keys: Float64Array | undefined,
  suns: readonly VsmClipmap[],
) {
  const { motion } = spheres
  if (
    !asked ||
    asked.spheres !== spheres ||
    asked.first !== range.first ||
    asked.end !== range.end ||
    asked.derived !== motion.derived ||
    asked.travel !== motion.travel ||
    asked.margin !== margin ||
    asked.lampKeys !== keys ||
    asked.suns.length !== suns.length
  )
    return false
  for (let s = 0; s < suns.length; s++) {
    const was = asked.suns[s],
      clipmap = suns[s]
    if (was.clipmap !== clipmap) return false
    if (!sameValues(sunAxes(clipmap.lightViewRotation, sunNow.axes), was.axes)) return false
    if (!sameValues(splitRef(clipmap.eyeWorld, sunNow.ref), was.ref)) return false
  }
  return true
}
