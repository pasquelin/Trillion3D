import type { PageRec } from '../selection/types.ts'
import type { CutDelta, IdDelta } from '../cut/adoption/delta.ts'
import { createDenseKeySet } from '../cut/adoption/denseKeys.ts'
import { createKeyUnion } from '../cut/adoption/keyUnion.ts'
import { createPageCatalogue, type PageList } from '../selection/catalogue.ts'
import { createCoverHolders } from './coverHolders.ts'
import { createStreamedPages } from './streamedPages.ts'
import type { WebgpuPageTracking } from '../rows/page/pageTracking.ts'
import { byteLengths } from '../../../../math/src/sequence/byteLengths.ts'

export type WebgpuResidencySets = ReturnType<typeof createWebgpuResidencySets>

/**
 * The sets an image decides residency with, carried from one image to the next instead of rebuilt.
 *
 * `desired` is what the image asks the cache for — the pinned cover and the cut — and `keep` adds
 * what the image draws, which the cache must not reclaim under it. The root cover counts its
 * holders per key (`bootstrapKey`): the session holds its roots from open, and each cell held adds
 * a holder to the roots it alone needs (`holdCover`); a key is covered while it has one — kept,
 * pinned and never weighed by the budget. The cut arrives as a DELTA of each view's GPU readback,
 * so a moving camera costs the pages that changed and a still camera nothing at all.
 * `tracking.wanted` is what the pool took on of it: each desired page whose streaming page the
 * streaming holds, started or resident (`streamed`, `./streamedPages.ts`, by streaming page) — the
 * streaming `take`s the desired pages of a streaming page it starts and `drop`s every page of one
 * it lets go, and a desired page joins or leaves as the cut asks it while the streaming holds its
 * streaming page.
 */
export function createWebgpuResidencySets(options: {
  tracking: WebgpuPageTracking
  /** Holders per key of the root cover, the session's set at open; `holdCover` moves the rest. */
  bootstrapKey: Uint8Array
  packedPages: PageList
}) {
  const { tracking, bootstrapKey, packedPages } = options
  const { keyCount, keyOf, wanted, wantedPages, units } = tracking
  /** A packed rank back to its record: the one catalogue accessor (`../selection/catalogue.ts`). */
  const { recordOf } = createPageCatalogue(packedPages)
  /** What joined and left the root cover since the pin step last ran (`pinUpdater.ts`): the
   *  session's cover at open, then each cell's. */
  const coverEntering = createDenseKeySet(),
    coverLeaving = createDenseKeySet()
  /** The streaming pages the streaming holds, the root cover apart. */
  const streamed = createStreamedPages()
  const desired = createDenseKeySet()
  const requested = createKeyUnion({
    members: desired,
    keyCount,
    covered: bootstrapKey,
    onListed: (key, page) => {
      if (streamed.has(units.of(key))) take(key, page)
    },
    onUnlisted: (key) => drop(key),
  })
  const keep = createKeyUnion({ members: tracking.keep, keyCount })
  for (let key = 0; key < keyCount; key++)
    if (bootstrapKey[key]) {
      keep.retain(key)
      coverEntering.add(key)
    }
  const cover = createCoverHolders({
    ...{ holders: bootstrapKey, keyOf, unitOf: units.of, requested, keep },
    joined: (key) => (coverLeaving.remove(key), coverEntering.add(key)),
    left: (key) => (coverEntering.remove(key), coverLeaving.add(key)),
  })
  /** Bumped whenever what the pool took on changes, so what `accepts` answers may have changed. */
  let acceptedRevision = 0
  /** Taken on by the pool is what makes the image hold a page; let go, the page goes. */
  function take(key: number, page?: PageRec) {
    if (!wanted.add(key, page)) return
    acceptedRevision++
    keep.retain(key, page)
  }
  function drop(key: number) {
    if (!wanted.remove(key)) return
    acceptedRevision++
    keep.release(key)
  }
  /**
   * A cut's difference into `union`: each placement that entered holds its page's cache key — cached
   * on its record by the tracking (`PageRec.keyIndex`) — and each that left lets it go. Several
   * placements of one page share a key: the union counts them with its other holders, so a key is
   * listed with its first holder and unlisted with its last, and an image that moves no page
   * touches nothing.
   */
  const follow = (union: typeof requested, delta: IdDelta) => {
    for (let i = 0; i < delta.exitedCount; i++) union.release(keyOf(recordOf(delta.exited[i])!))
    for (let i = 0; i < delta.enteredCount; i++) {
      const page = recordOf(delta.entered[i])!
      union.retain(keyOf(page), page)
    }
  }
  return {
    coverEntering,
    coverLeaving,
    /** The streaming pages the streaming holds, started or resident, in their use order. */
    streamed,
    /** The streaming started `key`'s streaming page, or holds it resident: `key`, `page`'s, taken
     *  on while desired. */
    take,
    /** The streaming let `key`'s streaming page go. */
    drop,
    /** Where `page` stands in the order the streaming started what the pool waits on: -1 for the
     *  pinned cover, which comes first (`./streamedPages.ts`, `rankOf`, by streaming page). */
    queueRank: (page: PageRec) => streamed.rankOf(units.of(keyOf(page))),
    /** Advanced by every start (`queueRank`). */
    get rankRevision() {
      return streamed.revision
    },
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
      return byteLengths(coverEntering, coverLeaving, requested, keep, wanted, cover, streamed)
    },
    /** Changes whenever `accepts` may answer differently. */
    get acceptedRevision() {
      return acceptedRevision
    },
    /** True when this image asks the cache for the key, even past the page budget. */
    requests: (key: number) => desired.has(key),
    /** True when the pool accepted the page: the pinned cover, or a desired page the streaming
     *  started or holds. One it has not started is drawn by its nearest resident ancestor and never
     *  awaited. */
    accepts: (page: PageRec) => {
      const key = keyOf(page)
      return bootstrapKey[key] > 0 || wanted.has(key)
    },
    /** Applies one difference of what the cut asks for — its pages and the groups they close over
     *  (`../cut/groupClosure.ts`): only the pages that entered and left are touched. */
    applyCut(delta: IdDelta) {
      follow(requested, delta)
    },
    /** `pages` gain a holder, `held`, or lose one (`coverHolders.ts`). */
    holdCover(pages: readonly PageRec[], held: boolean) {
      if (cover.hold(pages, held)) acceptedRevision++
    },
    /** The pool slots the root cover takes now, a streaming page each (`coverHolders.ts`). */
    get coverSlots() {
      return cover.covered
    },
    coverMissing: cover.missing,
    /** Applies one difference of the drawable cut, which is what the image must not lose. It is not
     *  a subset of what the cut asks for: a cluster whose replacement is missing is drawn from a
     *  resident ancestor the cut never asked for, and the cache must not reclaim it on screen. */
    applyDrawn(delta: CutDelta) {
      follow(keep, delta)
    },
    wantedPages,
  }
}
