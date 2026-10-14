/**
 * A HISTOGRAM'S SUNS, AND WHETHER AN ASK REPEATS THE LAST (`rowBinsParams.ts`): a sun is binned
 * along its clipmap's light-space x and y about its reference split as the spheres are; an ask
 * whose inputs all equal those of the last histogram submitted would bin the same words, and is not
 * made. A landed histogram bounds a frame whose suns hold its axes (`rowPageBound.ts`).
 */
import { sameValues } from '../../../math/src/matrix/matrixElements.ts'
import { writeSplitDouble } from '../../../math/src/float/splitDouble.ts'
import type { VsmClipmap } from './clipmap.ts'
import type { BinnedSun, RowBinsScene, RowBinsTag } from './rowBinsRecord.ts'

/** The world directions of a clipmap's light-space x and y axes, into `out`. */
const sunAxes = (m: ArrayLike<number>, out: Float64Array) => {
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

/** A sun's axes and reference as this frame holds them (`frameSuns`). */
interface SunNow {
  axes: Float64Array
  ref: Float32Array
}
/** Each of this frame's suns' (`frameSuns`), rewritten by each call. */
const now: SunNow[] = []

/** The axes of each of `suns` this frame and, when `refs`, its reference, computed once an ask:
 *  read before the next call, which rewrites them (a reference not asked for is left as it was). */
export function frameSuns(suns: readonly VsmClipmap[], refs: boolean): readonly SunNow[] {
  for (let s = 0; s < suns.length; s++) {
    const sun = (now[s] ??= { axes: new Float64Array(6), ref: new Float32Array(6) })
    sunAxes(suns[s].lightViewRotation, sun.axes)
    if (refs) splitRef(suns[s].eyeWorld, sun.ref)
  }
  return now
}

/** Whether `binned` holds `suns`, in order, each along the axes it holds now (`frameSuns`'s
 *  `values`) and, when `refs`, about the same reference (`values` then made with theirs). */
export function sameSuns(
  binned: readonly BinnedSun[],
  suns: readonly VsmClipmap[],
  values: readonly SunNow[],
  refs: boolean,
) {
  if (binned.length !== suns.length) return false
  for (let s = 0; s < suns.length; s++) {
    const was = binned[s]
    if (was.clipmap !== suns[s] || !sameValues(values[s].axes, was.axes)) return false
    if (refs && !sameValues(values[s].ref, was.ref)) return false
  }
  return true
}

/** Whether `asked` — the last histogram submitted (`RowBins.asked`) — was asked with these very
 *  inputs: the same spheres and mobility buffers, rows, motion sums and margin, lamps' keys, and
 *  suns along the same axes about the same reference (`values`, `frameSuns`). Its histogram then is
 *  the one this ask would bin. */
export function sameAsk(
  asked: RowBinsTag | undefined,
  scene: RowBinsScene,
  range: { first: number; end: number },
  margin: number,
  keys: Float64Array | undefined,
  suns: readonly VsmClipmap[],
  values: readonly SunNow[],
) {
  const { motion } = scene.rowSpheres
  return (
    !!asked &&
    asked.spheres === scene.rowSpheres &&
    asked.sphereBuffer === scene.spheres &&
    asked.mobility === scene.mobility &&
    asked.first === range.first &&
    asked.end === range.end &&
    asked.derived === motion.derived &&
    asked.travel === motion.travel &&
    asked.margin === margin &&
    asked.lampKeys === keys &&
    sameSuns(asked.suns, suns, values, true)
  )
}
