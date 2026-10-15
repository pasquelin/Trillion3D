import type { WebgpuResidencySets } from './sets.ts'
import type { WebgpuPageTracking } from '../row/pageTracking.ts'
import type { GroupClosure } from '../../page/cut/groupClosure.ts'
import type { GpuCut } from '../../gpu/core/selection.ts'

/** The views' cuts admission reads: each view's readback last adopted, a drawn capture's apart —
 *  ranked first (#268) — (`../cut/publication.ts`, `viewReadbacks`). */
export type ViewReadbacks = {
  readonly cuts: readonly GpuCut[]
  readonly first: GpuCut | null
}

/** The pool turns short once the views' cuts pass it, and whole again only once they fall a tenth
 *  below it: a cut at the pool's edge does not flip the GPU's ranking — and the queue — image after
 *  image. */
const SHORT_LEAVE = 0.9
/**
 * Admission of the views' cuts under the one pool (#1483). The queue is the cuts' asks ranked by
 * admission, the first `room` of them (`rankedQueue.ts`): the minimum capacity's pages, the
 * coarsest level, then the finer, a complete cover plus as much detail as the slots carry
 * (docs/RESIDENCY.md) — the cuts whole while the pool holds them. Admission names the room, and
 * lifts the keys a drawn capture's cut closes over above every other (#268): walked once a capture
 * readback, never the views'. Short — the cuts past the pool — the GPU ranks the camera's requests
 * by admission too (`SelectionUniforms.admitByLevel`), so a list it truncates keeps the coarsest.
 */
export function createRequestAdmission(
  sets: WebgpuResidencySets,
  tracking: Pick<WebgpuPageTracking, 'keyOf'>,
  closure: Pick<GroupClosure, 'closeOver'>,
) {
  /** The pool was short at the last admission (`settleShort`). */
  let wasShort = false,
    /** The capture readback whose keys are lifted. */
    lifted: GpuCut | null = null
  /** Whether the pool cannot hold the views' cuts whole, with its margin (`SHORT_LEAVE`) once it
   *  was short: read alone, it moves nothing — the image asks it before it cuts (`gpuCut.ts`). */
  const short = (slots: number) => sets.desiredCount > (wasShort ? SHORT_LEAVE * slots : slots)
  const admit = (slots: number, { first }: ViewReadbacks) => {
    wasShort = short(slots)
    sets.setRoom(slots)
    if (first === lifted) return
    lifted = first
    const keys = new Set<number>()
    if (first) closure.closeOver(first.result.pageIds, (_id, rec) => keys.add(tracking.keyOf(rec)))
    sets.lift(keys)
  }
  return Object.assign(admit, { short })
}
