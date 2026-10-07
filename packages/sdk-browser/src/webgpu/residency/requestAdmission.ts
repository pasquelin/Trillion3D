import type { PageRec } from '../../page/selection/selection.ts'
import type { GroupClosure } from '../../page/cut/groupClosure.ts'
import type { WebgpuResidencySets } from './sets.ts'
import type { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { admissionLevel } from '../../residency/minimumCapacity.ts'
import { createReadbackMerge, type ViewReadbacks } from './readbackMerge.ts'
import { ADMISSION_LEVEL_MAX } from '../../gpu/dag/request.ts'
import {
  createLevelFiling,
  filePage,
  filingBytes,
  filingFull,
  openFiling,
  rankFiling,
  type LevelFiling,
} from './levelFiling.ts'

type Tracking = ReturnType<typeof createWebgpuPageTracking>
/** The pool turns short once the views' cuts pass it, and whole again only once they fall a tenth
 *  below it: a cut at the pool's edge does not flip the GPU's ranking — and the queue — image after
 *  image. */
const SHORT_LEAVE = 0.9
/**
 * Admission of the views' cuts under the one pool, in the order the GPU ranked them (#1483). A cut
 * the pool holds whole is the queue itself, followed by difference. One it does not hold has the GPU
 * rank the camera's requests by ADMISSION (`SelectionUniforms.admitByLevel`,
 * `../../gpu/dag/request.ts`) — the minimum capacity's pages (`../../residency/minimumCapacity.ts`),
 * the coarsest level, the larger error —: a complete cover plus as much detail as the slots carry,
 * one level at a time (docs/RESIDENCY.md). The host sorts no request list: it walks the views'
 * lists merged level by level — a drawn capture's first, so it keeps what its cut alone kept
 * (#268) —, closes each request over its groups (`../../page/cut/groupClosure.ts`), and stops at
 * the first request finer than the one the room ran out at. Of what it filed — each page at its
 * own level, a request bringing the coarser groups its rule needs — it takes the coarsest levels
 * whole and the straddled one in part, what the queue holds of it first, in the queue's order: a
 * queue re-ranked to the race of the GPU's threads would trade slots at every readback. The room
 * is the pool's; only a new readback, room or queue is walked again (#483 rule 6).
 */
export function createRequestAdmission(
  sets: WebgpuResidencySets,
  { keyOf, wanted, topLevel }: Pick<Tracking, 'keyOf' | 'wanted' | 'topLevel'>,
  closure: Pick<GroupClosure, 'closeOver'>,
  recordOf: (id: number) => PageRec | undefined,
) {
  let lastRoom = -1,
    lastRevision = -1,
    /** The pool was short at the last admission (`settleShort`). */
    wasShort = false
  /** The readbacks the last admission walked: a capture's, then the views'. */
  let lastFirst: unknown = null
  const lastCuts: unknown[] = []
  const { merge, merged } = admissionMerge(recordOf, topLevel)
  const filing = createLevelFiling(keyOf, (key) => sets.covers(key), topLevel, merged)
  const walk: Walk = {
    merge,
    closure,
    wanted,
    visit: (_id: number, rec: PageRec) => filePage(filing, rec),
    full: () => filingFull(filing),
  }
  /** Whether the pool cannot hold the views' cuts whole, with its margin (`SHORT_LEAVE`) once it
   *  was short: read alone, it moves nothing — the image asks it before it cuts (`gpuCut.ts`). */
  const short = (slots: number) => sets.desiredCount > (wasShort ? SHORT_LEAVE * slots : slots)
  /** The verdict an admission settles on, once an image: the margin follows it. */
  const settleShort = (slots: number) => (wasShort = short(slots))
  /** Whether `readbacks` are the ones the last admission walked, in the same room. */
  const walked = (slots: number, { cuts, first }: ViewReadbacks) =>
    slots === lastRoom &&
    sets.acceptedRevision === lastRevision &&
    first === lastFirst &&
    cuts.length === lastCuts.length &&
    cuts.every((cut, i) => cut === lastCuts[i])
  const admit = (slots: number, readbacks: ViewReadbacks) => {
    // The queue follows the cuts whole: no ranking is kept for a pool that holds them.
    if (!settleShort(slots)) {
      lastCuts.length = 0
      lastFirst = null
      return sets.followDesired()
    }
    const { cuts, first } = readbacks
    // No readback yet, or the ones already walked: the queue the image holds stands.
    if (walked(slots, readbacks) || (!cuts.length && !first)) return
    lastFirst = first
    lastCuts.length = 0
    lastCuts.push(...cuts)
    // Ranked first: `rankFiling` may grow the queue the sets read.
    const taken = fileReadbacks(filing, slots, readbacks, walk)
    sets.admit(filing.queue, filing.queued, taken)
    lastRoom = slots
    lastRevision = sets.acceptedRevision
  }
  /** Bytes of its tables, sized by the views' requests and the room: the CPU budget holds them with
   *  the cut's other host tables (`../cut/publication.ts`, `hostTableBytes`). */
  const hostBytes = () => filingBytes(filing) + merged.ids.byteLength + merged.levels.byteLength
  return Object.assign(admit, { short, hostBytes })
}

/** The views' requests merged, and the admission level of each. */
function admissionMerge(recordOf: (id: number) => PageRec | undefined, topLevel: number) {
  const levelOf = (id: number) => {
    const rec = recordOf(id)
    return rec ? admissionLevel(rec, topLevel) : 0
  }
  /** An admission bucket's level (`../../gpu/dag/readoutWords.ts`, `levelCountsWord`): its level,
   *  raised past `topLevel` with the minimum capacity's bit, as `admissionLevel` raises it. */
  const bucketLevel = (bucket: number) =>
    (bucket & ADMISSION_LEVEL_MAX) + (bucket > ADMISSION_LEVEL_MAX ? topLevel + 1 : 0)
  return createReadbackMerge(levelOf, bucketLevel)
}

/** What a walk reads besides the filing: the merge, the closure, the queue, the closure's visit
 *  and its stop. */
type Walk = {
  merge: ReturnType<typeof createReadbackMerge>['merge']
  closure: Pick<GroupClosure, 'closeOver'>
  wanted: Tracking['wanted']
  visit: (id: number, rec: PageRec) => void
  full: () => boolean
}

/** The views' readbacks walked in `slots` and ranked: how many the queue takes. */
function fileReadbacks(filing: LevelFiling, slots: number, readbacks: ViewReadbacks, walk: Walk) {
  const { cuts, first } = readbacks
  // A list cut before the pool turned short is in the cut's order, not admission's: the walk
  // cannot stop at the first finer request, it files every one.
  const ranked =
    cuts.every((cut) => !!cut.uniforms.admitByLevel) && (!first || !!first.uniforms.admitByLevel)
  openFiling(filing, slots, ranked)
  // No room: an empty queue, without walking what it would rank.
  if (slots <= 0) {
    filing.queued.length = 0
    return 0
  }
  const { ids, count } = walk.merge(readbacks, filing.lift)
  walk.closure.closeOver(ids.subarray(0, count), walk.visit, walk.full)
  return rankFiling(filing, walk.wanted)
}
