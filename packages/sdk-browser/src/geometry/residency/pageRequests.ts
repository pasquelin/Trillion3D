import type { PageRec } from '../selection/types.ts'
import type { GpuCut } from '../../gpu/core/selection.ts'
import type { GroupClosure } from '../cut/groupClosure.ts'
import { createSparseInts } from '../cut/sparseInts.ts'
import { createPageCatalogue, type PageList } from '../selection/catalogue.ts'
import { hasPage } from '../rows/page/pageSlots.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { REQUEST_PRIORITY_MAX } from '../dag/request/request.ts'

/** The updates a prefetch asks its pages for at most, whatever its asker names: a wrong count
 *  never keeps one for good. */
const PREFETCH_UPDATES_MAX = 30

/** A prefetch: packed pages, the updates it still asks them for, and their priority this update
 *  beside each, for the walk of what they depend on. */
type Prefetch = { pages: readonly number[]; left: number; ranks: Uint32Array }

/**
 * THE REQUESTS OF ONE UPDATE, by STREAMING PAGE — the unit the residency streams
 * (`./pageUnits.ts`) —: the streaming pages of the pages the views' readbacks ask for, each at the
 * highest priority a request of one of its pages takes — the GPU's, the larger the more urgent
 * (`../../gpu/core/selection.ts`, `SelectionResult.priorities`) —; then the prefetches
 * (`prefetch`), each page at the highest priority a request takes less the updates left before
 * its asker draws it — above every view's, the nearer the deadline the higher —; then what they
 * all depend on: each group a request's cut rule needs, up to the roots, one higher per group
 * above the request that brings it, the highest any brings (`../cut/groupClosure.ts`,
 * `closeOver`). The root cover is no request: it is held apart (`covers`).
 *
 * `keys` lists the streaming pages once each, the views' requests first, in their readbacks'
 * order, then the prefetches', then what they depend on, in the walk's order: the order the
 * streaming moves them to the end of its use order (`./streamedPages.ts`). Their count is the
 * update's unique requests, what the pool's pressure reads (`./poolPressure.ts`). The tables follow
 * the requests, never the catalogue.
 */
export function createPageRequests(options: {
  packedPages: PageList
  keyOf: (rec: PageRec) => number
  /** The streaming page of a key (`./pageUnits.ts`). */
  unitOf: (key: number) => number
  /** True for a key of the root cover. */
  covers: (key: number) => boolean
  closure: Pick<GroupClosure, 'closeOver'>
}) {
  const { keyOf, unitOf, covers, closure } = options
  const { recordOf } = createPageCatalogue(options.packedPages)
  /** Each requested streaming page's priority, a u32 held in an int's bits. */
  const priority = createSparseInts()
  /** The streaming pages requested, and beside each the record it was first requested by. */
  let keys = new Int32Array(64),
    count = 0
  const records: PageRec[] = []
  const note = (rec: PageRec, asked: number) => {
    // A record without a page — a world cluster no surface wears — is no streaming page: it has
    // no bytes to wait for, and one started would hold every install behind it.
    if (!hasPage(rec)) return
    const key = keyOf(rec)
    if (covers(key)) return
    const unit = unitOf(key),
      held = priority.get(unit) >>> 0
    if (held === 0) {
      keys = resized(keys, count + 1)
      records[count] = rec
      keys[count++] = unit
    }
    if (asked > held) priority.set(unit, asked | 0)
  }
  const visit = (_id: number, rec: PageRec, asked: number) => note(rec, asked)
  /** The prefetches still asking, in the order asked. */
  const prefetches: Prefetch[] = []
  return {
    /** The requests of `cuts`, the readbacks of the update, the drawn capture's first, then the
     *  prefetches' — each one update nearer its deadline, let go once there —, then what they
     *  depend on. */
    take(cuts: readonly GpuCut[]) {
      priority.clear()
      count = records.length = 0
      for (const { result } of cuts) {
        const { pageIds, priorities } = result
        for (let i = 0; i < pageIds.length; i++) {
          const rec = recordOf(pageIds[i])
          if (rec) note(rec, Math.max(1, priorities[i] >>> 0))
        }
      }
      for (const ask of prefetches) {
        const asked = REQUEST_PRIORITY_MAX - ask.left--
        ask.ranks.fill(asked)
        for (const id of ask.pages) {
          const rec = recordOf(id)
          if (rec) note(rec, asked)
        }
      }
      for (const { result } of cuts) closure.closeOver(result.pageIds, visit, result.priorities)
      for (const ask of prefetches) closure.closeOver(ask.pages, visit, ask.ranks)
      // Those whose updates are spent let go, the others kept in their order, in place.
      let kept = 0
      for (const ask of prefetches) if (ask.left > 0) prefetches[kept++] = ask
      prefetches.length = kept
    },
    /** Asks packed pages `pages` for the next `updates` updates — at least one, at most
     *  `PREFETCH_UPDATES_MAX` —, the asker drawing them after: ahead of the views' requests. */
    prefetch(pages: readonly number[], updates: number) {
      const left = Math.min(Math.max(1, updates), PREFETCH_UPDATES_MAX)
      prefetches.push({ pages, left, ranks: new Uint32Array(pages.length) })
    },
    /** The streaming pages requested, in the order above: read up to `count`. */
    get keys() {
      return keys
    },
    /** The record the streaming page at place `at` was first requested by. */
    recordAt: (at: number) => records[at],
    /** Unique streaming pages requested, the root cover apart. */
    get count() {
      return count
    },
    /** Whether this update requests streaming page `unit`: one it uses, never a victim. */
    requested: (unit: number) => priority.get(unit) !== 0,
    /** `unit`'s priority this update, 0 for one it does not request. */
    priorityOf: (unit: number) => priority.get(unit) >>> 0,
    /** Bytes of its tables, bounded by the requests and the prefetches asking. */
    get byteLength() {
      let asking = 0
      for (const ask of prefetches) asking += ask.pages.length * 8 + ask.ranks.byteLength
      return priority.byteLength + keys.byteLength + records.length * 8 + asking
    },
  }
}

export type PageRequests = ReturnType<typeof createPageRequests>
