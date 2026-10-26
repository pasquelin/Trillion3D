import type { PageRec } from '../selection/types.ts'
import type { CutDelta, IdDelta } from '../cut/adoption/delta.ts'
import { createDenseKeySet } from '../cut/adoption/denseKeys.ts'
import { createKeyUnion } from '../cut/adoption/keyUnion.ts'
import { createPageCatalogue, type PageList } from '../selection/catalogue.ts'
import { createCoverHolders } from './coverHolders.ts'
import { createStreamedPages } from './streamedPages.ts'
import type { WebgpuPageTracking } from '../rows/page/pageTracking.ts'
import { joinMembers } from '../members.ts'
import { byteLengths } from '../../../../math/src/sequence/byteLengths.ts'

export type WebgpuResidencySets = ReturnType<typeof createWebgpuResidencySets>

/** What the sets keep from one image to the next. */
interface Sets {
  options: SetsOptions
  /** A packed rank back to its record: the one catalogue accessor (`../selection/catalogue.ts`). */
  recordOf: (page: number) => PageRec | undefined
  /** What joined and left the root cover since the pin step last ran (`pinUpdater.ts`): the
   *  session's cover at open, then each cell's. */
  coverEntering: ReturnType<typeof createDenseKeySet>
  coverLeaving: ReturnType<typeof createDenseKeySet>
  /** The streaming pages the streaming holds, the root cover apart. */
  streamed: ReturnType<typeof createStreamedPages>
  desired: ReturnType<typeof createDenseKeySet>
  requested: ReturnType<typeof createKeyUnion>
  keep: ReturnType<typeof createKeyUnion>
  cover: ReturnType<typeof createCoverHolders>
  /** Bumped whenever what the pool took on changes, so what `accepts` answers may have changed. */
  acceptedRevision: number
  /** The drawn clusters above the finest level (`applyDrawn`), a placement's each: none when the
   *  image draws the finest level everywhere. */
  drawnCoarse: number
}

const isCoarse = (page: PageRec) => (page.level ?? 0) > 0

/** Taken on by the pool is what makes the image hold a page; let go, the page goes. */
function takeKey(s: Sets, key: number, page?: PageRec) {
  if (!s.options.tracking.wanted.add(key, page)) return
  s.acceptedRevision++
  s.keep.retain(key, page)
}

function dropKey(s: Sets, key: number) {
  if (!s.options.tracking.wanted.remove(key)) return
  s.acceptedRevision++
  s.keep.release(key)
}

/**
 * A cut's difference into `union`: each placement that entered holds its page's cache key — cached
 * on its record by the tracking (`PageRec.keyIndex`) — and each that left lets it go. Several
 * placements of one page share a key: the union counts them with its other holders, so a key is
 * listed with its first holder and unlisted with its last, and an image that moves no page
 * touches nothing.
 */
function followDelta(s: Sets, union: Sets['requested'], delta: IdDelta) {
  const { keyOf } = s.options.tracking
  for (let i = 0; i < delta.exitedCount; i++) union.release(keyOf(s.recordOf(delta.exited[i])!))
  for (let i = 0; i < delta.enteredCount; i++) {
    const page = s.recordOf(delta.entered[i])!
    union.retain(keyOf(page), page)
  }
}

/** The state of the sets: the cover of the session's roots entering, nothing yet asked. */
function createSetsState(options: SetsOptions): Sets {
  const { tracking, bootstrapKey, packedPages } = options
  const { keyCount, keyOf, units } = tracking
  const coverEntering = createDenseKeySet(),
    coverLeaving = createDenseKeySet()
  const streamed = createStreamedPages()
  const desired = createDenseKeySet()
  const requested = createKeyUnion({
    members: desired,
    keyCount,
    covered: bootstrapKey,
    onListed: (key, page) => {
      if (streamed.has(units.of(key))) takeKey(s, key, page)
    },
    onUnlisted: (key) => dropKey(s, key),
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
  const s: Sets = {
    options,
    recordOf: createPageCatalogue(packedPages).recordOf,
    ...{ coverEntering, coverLeaving, streamed, desired, requested, keep, cover },
    acceptedRevision: 0,
    drawnCoarse: 0,
  }
  return s
}

/** The members that read the sets: counts, revisions and what the image asks for. */
function setsQueries(s: Sets) {
  const { tracking, bootstrapKey } = s.options
  const { keyOf, wanted, units } = tracking
  return {
    /** Where `page` stands in the order the streaming started what the pool waits on: -1 for the
     *  pinned cover, which comes first (`./streamedPages.ts`, `rankOf`, by streaming page). */
    queueRank: (page: PageRec) => s.streamed.rankOf(units.of(keyOf(page))),
    /** Advanced by every start (`queueRank`). */
    get rankRevision() {
      return s.streamed.revision
    },
    /** True for a key of the pinned root cover, which no budget weighs. */
    covers: (key: number) => bootstrapKey[key] > 0,
    /** Keys this image asks the cache for, the pinned cover included. */
    get requestedCount() {
      return s.requested.size
    },
    /** Keys this image forbids the cache to reclaim: what it asks for plus what it draws. */
    get keepCount() {
      return tracking.keep.count
    },
    /** Bytes of every set above and of the tracking's: they follow what the image asks for, holds
     *  and draws, never the catalogue. */
    get hostBytes() {
      const { coverEntering, coverLeaving, requested, keep, streamed, cover } = s
      return byteLengths(coverEntering, coverLeaving, requested, keep, wanted, cover, streamed)
    },
    /** Changes whenever `accepts` may answer differently. */
    get acceptedRevision() {
      return s.acceptedRevision
    },
    /** True when this image asks the cache for the key, even past the page budget. */
    requests: (key: number) => s.desired.has(key),
    /** True when the pool accepted the page: the pinned cover, or a desired page the streaming
     *  started or holds. One it has not started is drawn by its nearest resident ancestor and never
     *  awaited. */
    accepts: (page: PageRec) => {
      const key = keyOf(page)
      return bootstrapKey[key] > 0 || wanted.has(key)
    },
    /** The pool slots the root cover takes now, a streaming page each (`coverHolders.ts`). */
    get coverSlots() {
      return s.cover.covered
    },
    coverMissing: s.cover.missing,
    /** The clusters the image draws above the finest level, a placement's each: what a budget that
     *  holds the pages of a finer level back leaves drawn (`gpuCutAdmission.ts`). */
    get drawnCoarse() {
      return s.drawnCoarse
    },
    wantedPages: tracking.wantedPages,
  }
}

/** The members that move the sets: the streaming's takes, the cut's differences and the cover. */
function setsMoves(s: Sets) {
  return {
    coverEntering: s.coverEntering,
    coverLeaving: s.coverLeaving,
    /** The streaming pages the streaming holds, started or resident, in their use order. */
    streamed: s.streamed,
    /** The streaming started `key`'s streaming page, or holds it resident: `key`, `page`'s, taken
     *  on while desired. */
    take: (key: number, page?: PageRec) => takeKey(s, key, page),
    /** The streaming let `key`'s streaming page go. */
    drop: (key: number) => dropKey(s, key),
    /** Applies one difference of what the cut asks for — its pages and the groups they close over
     *  (`../cut/groupClosure.ts`): only the pages that entered and left are touched. */
    applyCut(delta: IdDelta) {
      followDelta(s, s.requested, delta)
    },
    /** `pages` gain a holder, `held`, or lose one (`coverHolders.ts`). */
    holdCover(pages: readonly PageRec[], held: boolean) {
      if (s.cover.hold(pages, held)) s.acceptedRevision++
    },
    /** Applies one difference of the drawable cut, which is what the image must not lose. It is not
     *  a subset of what the cut asks for: a cluster whose replacement is missing is drawn from a
     *  resident ancestor the cut never asked for, and the cache must not reclaim it on screen. */
    applyDrawn(delta: CutDelta) {
      followDelta(s, s.keep, delta)
      for (let i = 0; i < delta.enteredCount; i++)
        if (isCoarse(s.recordOf(delta.entered[i])!)) s.drawnCoarse++
      for (let i = 0; i < delta.exitedCount; i++)
        if (isCoarse(s.recordOf(delta.exited[i])!)) s.drawnCoarse--
    },
  }
}

type SetsOptions = {
  tracking: WebgpuPageTracking
  /** Holders per key of the root cover, the session's set at open; `holdCover` moves the rest. */
  bootstrapKey: Uint8Array
  packedPages: PageList
}

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
export function createWebgpuResidencySets(options: SetsOptions) {
  const s = createSetsState(options)
  return joinMembers(setsQueries(s), setsMoves(s))
}
