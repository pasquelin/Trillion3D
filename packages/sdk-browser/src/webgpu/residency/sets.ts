import type { PageRec } from '../../page/selection/types.ts'
import type { CutDelta, IdDelta } from '../cut/delta.ts'
import { createDenseKeySet } from '../cut/denseKeys.ts'
import { createKeyUnion } from '../cut/keyUnion.ts'
import { createPageCatalogue, type PageList } from '../../page/selection/catalogue.ts'
import { createCoverHolders } from './coverHolders.ts'
import { admissionRank, createRankedQueue } from './rankedQueue.ts'
import type { WebgpuPageTracking } from '../row/pageTracking.ts'

export type WebgpuResidencySets = ReturnType<typeof createWebgpuResidencySets>

/**
 * The sets an image decides residency with, carried from one image to the next instead of rebuilt.
 *
 * `desired` is what the image asks the cache for — the pinned cover and the cut — and `keep` adds
 * what the image draws, which the cache must not reclaim under it. The root cover counts its
 * holders per key (`bootstrapKey`): the session holds its roots from open, and each cell held adds
 * a holder to the roots it alone needs (`holdCover`); a key is covered while it has one — kept,
 * pinned and never weighed by the budget. The cut arrives as a DELTA of
 * each view's GPU readback, so a moving camera costs the
 * pages that changed and a still camera nothing at all. `tracking.wanted` is what the upload queue
 * walks: the desired set ranked by admission, the first `room` of it (`rankedQueue.ts`) — the
 * desired set itself while the pool holds it.
 */
export function createWebgpuResidencySets(options: {
  tracking: WebgpuPageTracking
  /** Holders per key of the root cover, the session's set at open; `holdCover` moves the rest. */
  bootstrapKey: Uint8Array
  packedPages: PageList
}) {
  const { tracking, bootstrapKey, packedPages } = options
  const { keyCount, keyOf, wanted, wantedPages } = tracking
  /** A packed rank back to its record: the one catalogue accessor (`../../page/selection/catalogue.ts`). */
  const { recordOf } = createPageCatalogue(packedPages)
  /** What joined and left the root cover since the pin step last ran (`pinUpdater.ts`): the
   *  session's cover at open, then each cell's. */
  const coverEntering = createDenseKeySet(),
    coverLeaving = createDenseKeySet()
  const desiredPages: PageRec[] = []
  const desired = createDenseKeySet(desiredPages)
  const requested = createKeyUnion({
    members: desired,
    keyCount,
    covered: bootstrapKey,
    onListed: (key) => ranked.enter(key),
    onUnlisted: (key) => ranked.leave(key),
  })
  const keep = createKeyUnion({ members: tracking.keep, keyCount })
  for (let key = 0; key < keyCount; key++)
    if (bootstrapKey[key]) {
      keep.retain(key)
      coverEntering.add(key)
    }
  const cover = createCoverHolders({
    ...{ holders: bootstrapKey, keyOf, requested, keep },
    joined: (key) => (coverLeaving.remove(key), coverEntering.add(key)),
    left: (key) => (coverEntering.remove(key), coverLeaving.add(key)),
  })
  /** Bumped whenever the upload queue changes, so what `accepts` answers may have changed. */
  let acceptedRevision = 0
  /** Entering the upload queue is what makes the image hold a page; leaving it lets the page go. */
  const enqueue = (key: number, page?: PageRec) => {
    if (!wanted.add(key, page)) return
    acceptedRevision++
    keep.retain(key, page)
  }
  const dequeue = (key: number) => {
    if (!wanted.remove(key)) return
    acceptedRevision++
    keep.release(key)
  }
  /** The queue: the cuts' asks ranked by admission, the first `room` of them (`rankedQueue.ts`). */
  const ranked = createRankedQueue({
    enqueue,
    dequeue,
    pageOf: (key) => desiredPages[desired.indexOf(key)],
    wanted,
  })
  /**
   * A cut's difference into `union`: each placement that entered holds its page's cache key — cached
   * on its record by the tracking (`PageRec.keyIndex`) — and each that left lets it go. Several
   * placements of one page share a key: the union counts them with its other holders, so a key is
   * listed with its first holder and unlisted with its last, and an image that moves no page
   * touches nothing.
   */
  const follow = (union: typeof requested, delta: IdDelta) => {
    const ranks = union === requested
    for (let i = 0; i < delta.exitedCount; i++) {
      const page = recordOf(delta.exited[i])!
      if (ranks) ranked.drop(keyOf(page), admissionRank(page))
      union.release(keyOf(page))
    }
    for (let i = 0; i < delta.enteredCount; i++) {
      const page = recordOf(delta.entered[i])!
      if (ranks) ranked.hold(keyOf(page), admissionRank(page))
      union.retain(keyOf(page), page)
    }
  }
  return {
    coverEntering,
    coverLeaving,
    /** Keys the cut asks for beyond the pinned cover. */
    get desiredCount() {
      return desired.count
    },
    /** The slots the queue may fill, beyond the root cover. */
    setRoom: ranked.setRoom,
    /** The keys a drawn capture's cut closes over, ranked above every other (#268). */
    lift: ranked.lift,
    /** The queue laid out by rank, coarsest first, for the job that walks it. */
    orderQueue: ranked.order,
    /** True for a key of the pinned root cover, which no budget weighs. */
    covers: (key: number) => bootstrapKey[key] > 0,
    /** Keys this image asks the cache for, the pinned cover included. */
    get requestedCount() {
      return requested.size
    },
    /** Keys this image forbids the cache to reclaim: what it asks for plus what it draws. */
    get keepCount() {
      return tracking.keep.count
    },
    /** Bytes of every set above and of the tracking's: they follow what the image asks for, holds
     *  and draws, never the catalogue. */
    get hostBytes() {
      return (
        coverEntering.byteLength +
        coverLeaving.byteLength +
        requested.byteLength +
        keep.byteLength +
        wanted.byteLength +
        cover.byteLength +
        ranked.byteLength
      )
    },
    /** Changes whenever `accepts` may answer differently. */
    get acceptedRevision() {
      return acceptedRevision
    },
    /** True when this image asks the cache for the key, even past the page budget. */
    requests: (key: number) => desired.has(key),
    /** True when the pool accepted the page: the pinned cover, or the upload queue within the page
     *  budget. A page past the budget is drawn by its nearest resident ancestor and never awaited. */
    accepts: (page: PageRec) => {
      const key = keyOf(page)
      return bootstrapKey[key] > 0 || wanted.has(key)
    },
    /** Applies one difference of what the cut asks for — its pages and the groups they close over
     *  (`../../page/cut/groupClosure.ts`): only the pages that entered and left are touched. */
    applyCut(delta: IdDelta) {
      follow(requested, delta)
    },
    /** `pages` gain a holder, `held`, or lose one (`coverHolders.ts`). */
    holdCover(pages: readonly PageRec[], held: boolean) {
      if (cover.hold(pages, held)) acceptedRevision++
    },
    /** The pool slots the root cover takes now (`coverHolders.ts`). */
    get coverSlots() {
      return cover.covered
    },
    coverMissing: cover.missing,
    coverLacking: cover.lacking,
    /** Applies one difference of the drawable cut, which is what the image must not lose. It is not
     *  a subset of what the cut asks for: a cluster whose replacement is missing is drawn from a
     *  resident ancestor the cut never asked for, and the cache must not reclaim it on screen. */
    applyDrawn(delta: CutDelta) {
      follow(keep, delta)
    },
    wantedPages,
  }
}
