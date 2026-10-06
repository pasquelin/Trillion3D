import type { PageRec } from '../../page/selection/selection.ts'
import type { CutDelta, IdDelta } from '../cut/delta.ts'
import { createDenseKeySet } from '../cut/denseKeys.ts'
import { createKeyUnion } from '../cut/keyUnion.ts'
import { createHeldKeys } from '../cut/heldKeys.ts'
import { createPageCatalogue, type PageList } from '../pages/prepare/catalogue.ts'
import type { createWebgpuPageTracking } from '../row/pageTracking.ts'

type Tracking = ReturnType<typeof createWebgpuPageTracking>

export type WebgpuResidencySets = ReturnType<typeof createWebgpuResidencySets>

/**
 * The sets an image decides residency with, carried from one image to the next instead of rebuilt.
 *
 * `desired` is what the image asks the cache for — the pinned cover and the cut — and `keep` adds
 * what the image draws, which the cache must not reclaim under it. The cut arrives as a DELTA,
 * whether from the GPU sample or the CPU cut: one contract for both, so a moving camera costs the
 * pages that changed and a still camera nothing at all. `tracking.wanted` is what the upload queue
 * walks: the desired set itself, unless the page budget forces the coarser subset the admission
 * ranks (`requestAdmission.ts`), for either cut.
 */
export function createWebgpuResidencySets(options: {
  tracking: Tracking
  bootstrapKey: Uint8Array
  packedPages: PageList
}) {
  const { tracking, bootstrapKey, packedPages } = options
  const { keyCount, keyOf, wanted, wantedPages } = tracking
  /** A packed rank back to its record: the one catalogue accessor (`../pages/prepare/catalogue.ts`). */
  const { recordOf } = createPageCatalogue(packedPages)
  /** A packed page's cache key, cached on its record by the tracking (`PageRec.keyIndex`). */
  const keyOfId = (id: number) => keyOf(recordOf(id)!)
  /** What joined and left `keep` since the pin step last ran, each joining key beside the record
   *  it joined by (none for the pinned cover): the pin step reads its parents there. */
  const enteringPages: (PageRec | undefined)[] = []
  const entering = createDenseKeySet(enteringPages),
    leaving = createDenseKeySet()
  /** Bumped by every difference that moves what the cut closes over: the admission ranks the held
   *  cut again only then (`requestAdmission.ts`). */
  let cutRevision = 0
  const desiredPages: PageRec[] = []
  const desired = createDenseKeySet(desiredPages)
  let followsDesired = true
  const requested = createKeyUnion({
    members: desired,
    keyCount,
    covered: bootstrapKey,
    onListed: (key, page) => {
      if (followsDesired) enqueue(key, page)
    },
    onUnlisted: (key) => {
      if (followsDesired) dequeue(key)
    },
  })
  const keep = createKeyUnion({
    members: tracking.keep,
    keyCount,
    onListed: (key, page) => {
      leaving.remove(key)
      entering.add(key, page)
    },
    onUnlisted: (key) => {
      entering.remove(key)
      leaving.add(key)
    },
  })
  for (let key = 0; key < keyCount; key++) if (bootstrapKey[key]) keep.retain(key)
  /** Entering the upload queue is what makes the image hold a page; leaving it lets the page go. */
  /** Bumped whenever the upload queue changes, so what `accepts` answers may have changed. */
  let acceptedRevision = 0
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
  /** What the cut asks the cache for, and what the image actually draws. The second is not a subset
   *  of the first: a cluster whose replacement is missing is drawn from a resident ancestor the cut
   *  never asked for, and the cache must not reclaim it while it is on screen. */
  const askedKeys = createHeldKeys({
    keyOf: keyOfId,
    retain: (key, id) => requested.retain(key, recordOf(id)),
    release: (key) => requested.release(key),
  })
  const drawnKeys = createHeldKeys({
    keyOf: keyOfId,
    retain: (key: number, id: number) => keep.retain(key, recordOf(id)),
    release: (key: number) => keep.release(key),
  })
  /** Makes the queue the first `count` of `keys`, beside their records, unless it already holds
   *  those keys: new holds are taken before old ones are let go of, so a key in both never leaves
   *  `keep`, and a queue ranked again to the same pages changes nothing. */
  const admit = (keys: Int32Array, pages: readonly PageRec[], count: number) => {
    followsDesired = false
    let same = count === wanted.count
    for (let i = 0; same && i < count; i++) same = wanted.has(keys[i])
    if (same) return
    for (let i = 0; i < count; i++) keep.retain(keys[i], pages[i])
    for (let i = wanted.count - 1; i >= 0; i--) keep.release(wanted.list[i])
    wanted.clear()
    acceptedRevision++
    for (let i = 0; i < count; i++) wanted.add(keys[i], pages[i])
  }
  /** The queue follows the cut whole: every page it asks for fits the pool. */
  const followDesired = () => {
    if (followsDesired) return
    admit(desired.list, desiredPages, desired.count)
    followsDesired = true
  }
  return {
    /** A capture's cut while it is drawn, null otherwise: the budget ranks it before the rest of
     *  the union, so a capture keeps the pages it kept when its cut replaced the main view's
     *  (`requestAdmission.ts`, `../cut/publication.ts`). */
    drawnFirst: null as ArrayLike<number> | null,
    entering,
    enteringPages,
    leaving,
    /** Keys the cut asks for beyond the pinned cover. */
    get desiredCount() {
      return desired.count
    },
    /** Changes whenever a difference moved what the cut closes over. */
    get cutRevision() {
      return cutRevision
    },
    followDesired,
    admit,
    /** True for a key of the pinned root cover, which no budget weighs. */
    covers: (key: number) => bootstrapKey[key] === 1,
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
        entering.byteLength +
        leaving.byteLength +
        requested.byteLength +
        keep.byteLength +
        askedKeys.byteLength +
        drawnKeys.byteLength +
        wanted.byteLength +
        tracking.pinned.byteLength
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
      return bootstrapKey[key] === 1 || wanted.has(key)
    },
    /** Applies one difference of what the cut asks for — its pages and the groups they close over
     *  (`../../page/cut/groupClosure.ts`): only the pages that entered and left are touched. */
    applyCut(delta: IdDelta) {
      if (delta.enteredCount || delta.exitedCount) cutRevision++
      askedKeys.apply(delta)
    },
    /** Applies one difference of the drawable cut, which is what the image must not lose. */
    applyDrawn(delta: CutDelta) {
      drawnKeys.apply(delta)
    },
    wantedPages,
  }
}
