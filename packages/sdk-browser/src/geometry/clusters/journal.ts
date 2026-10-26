import { createDenseKeySet } from '../cut/adoption/denseKeys.ts'
import { createChangedRuns } from '../residency/ranges.ts'

/**
 * The two lists that drive the cluster residency.
 *
 * `touched` names pages whose residency or cache slot just moved: it is the only input of the
 * residency pass (`./clusterResidency.ts`), which therefore does not walk the catalogue. A page enrols only once, and the list follows what
 * moved, never the catalogue's size, so it cannot overflow: no burst of arrivals triggers the walk
 * of the 124,000 pages.
 *
 * `residencyChanges` is what the pass actually changed: pages whose residency FLAG flipped. GPU
 * selection writes only their ranges, and the list is read SORTED rather than in the order filled:
 * a page that leaves and a page that arrives are not named in the same order, and requiring
 * indices to increase sent selection back to walking the 124,000 pages as soon as a pass mixed
 * both. The one changed list (`createChangedRuns`) marks each page once, so it cannot overflow
 * either; a read takes what was noted since the last, joined to what it took before.
 *
 * Who else wants to know a page has just been named: `touchPage` is the only place the three ways
 * a cluster's coverage flips go through — bytes received, bytes returned, cache slot taken or
 * returned — so the cut totals hook there without a list being walked once more. Notified on every
 * call, duplicates included: what it does is idempotent, and a flip both ways must not go unseen.
 * One only, because cut publication is unique: a subscriber list would suggest the opposite.
 */
export function createClusterJournal() {
  const changed = createChangedRuns()
  let taken: Int32Array = new Int32Array(0)
  /** Every page noted since the last clear, increasing: GPU selection reads ranges. */
  const settled = () => {
    if (!changed.count) return taken
    for (const page of taken) changed.mark(page)
    return (taken = changed.take())
  }
  const residencyChanges = {
    get pages() {
      return settled()
    },
    get count() {
      return settled().length
    },
  }
  const clearResidencyChanges = () => {
    changed.clear()
    taken = taken.subarray(0, 0)
  }
  const touchedSet = createDenseKeySet()
  const touched = {
    get pages() {
      return touchedSet.list
    },
    get count() {
      return touchedSet.count
    },
  }
  let watcher: ((page: number) => void) | undefined
  /** Advanced by every page named: what a reader of the pages' bytes and slots compares. */
  let touchRevision = 0
  const touchPage = (page: number) => {
    touchRevision++
    touchedSet.add(page)
    if (watcher) watcher(page)
  }
  return {
    residencyChanges,
    noteResidencyChange: (page: number) => changed.mark(page),
    clearResidencyChanges,
    touched,
    touchPage,
    /** Advanced by every `touchPage`: bytes received or returned, a cache slot taken or given. A
     *  function, as the cluster state spreads the journal (`clusterState.ts`). */
    touchRevision: () => touchRevision,
    /** The one watcher of `touchPage` (the cut publication): a second one is a defect. */
    watchTouched(watch: (page: number) => void) {
      if (watcher) throw new Error('CLUSTER_JOURNAL_WATCHED_TWICE')
      watcher = watch
    },
    clearTouched: touchedSet.clear,
  }
}
