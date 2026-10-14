// The frustum verdict item by item on the CPU, in exact doubles: the float64 oracle the GPU
// verdict (`verdictWgsl.ts`, single precision under a proven margin) must contain — every item it
// keeps kept, a difference only within the margin of a plane (`verdictWgsl.test.ts`).
import { bitWords } from '../../../../math/src/scalar/integers.ts'
import { setBit } from '../../../../math/src/scalar/bits.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { frustumExcludesBox } from '../../../../math/src/geometry/frustum/box.ts'
import { notDrawn } from '../../placement/hidden.ts'
import { waterRankOf } from '../transparent/transmission.ts'
import type { WebgpuBlendState } from './state.ts'

/**
 * What the verdict leaves for the image: the keep words, the drawn items drawing nothing, the
 * drawn transmissive items in view, and whether each water rank draws. A paged item is kept when
 * drawn, and draws what the compaction counted for it (`counts`, by paged rank); an unpaged one is
 * kept unless its box lies outside the frustum (`frustumExcludesBox`).
 */
export function blendVerdictCpu(blendState: WebgpuBlendState, counts: ArrayLike<number> = []) {
  const items = blendState.blendGpu,
    planes = blendState.blendPlanes,
    draws = blendState.drawsPacked
  const keep = new Uint32Array(bitWords(items.length)),
    waterDraws = new Uint32Array(blendState.transmissive)
  let rejected = 0,
    inView = 0
  items.forEach((item, i) => {
    const water = waterRankOf(item.flags)
    if (notDrawn(item)) {
      if (water) waterDraws[water - 1] = 0
      return
    }
    const paged = draws[i * 4] !== NO_INDEX,
      box = item.bounds
    const excluded =
      !!box &&
      (!paged || !!water) &&
      frustumExcludesBox(planes, box[0], box[1], box[2], box[3], box[4], box[5])
    const held = paged ? counts[draws[i * 4]] !== 0 : !excluded
    if (paged || !excluded) setBit(keep, i)
    if (!held) rejected++
    if (!water) return
    if (!excluded) inView++
    waterDraws[water - 1] = held ? 1 : 0
  })
  return { keep, rejected, inView, waterDraws }
}
