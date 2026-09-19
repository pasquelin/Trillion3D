import { sortPages } from '../sdk-core/index.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';

/**
 * The two lists that drive the row table.
 *
 * `touched` names pages whose residency or cache slot just moved: it is the only input of rank sync,
 * which therefore no longer walks the catalogue. It has the catalogue's size and a per-page mark, so
 * a page enrols only once and it can no longer overflow: no burst of arrivals triggers the walk of
 * the 124,000 pages that cost the image's peak any more.
 *
 * `residencyChanges` is what the pass actually changed: pages whose residency FLAG flipped. GPU
 * selection writes only their ranges while `sorted` holds, and the list is SORTED at the end of the
 * pass rather than filled in order: a page that leaves and a page that arrives are not named in the
 * same order, and requiring indices to increase sent selection back to walking the 124,000 pages as
 * soon as a pass mixed both. Per-page marking forbids the duplicate, so the list cannot overflow
 * either.
 */
export function createWebgpuRowJournal(pageCount: number) {
  const changed = createDenseKeySet(pageCount);
  const residencyChanges = {
    pages: changed.list,
    get count() {
      return changed.count;
    },
    sorted: true,
  };
  /** Sorts the journal: GPU selection reads ranges, therefore increasing indices. */
  const sortResidencyChanges = () => {
    sortPages(changed.list, changed.count);
  };
  const clearResidencyChanges = () => {
    changed.clear();
    residencyChanges.sorted = true;
  };
  const touchedSet = createDenseKeySet(pageCount);
  const touched = {
    pages: touchedSet.list,
    get count() {
      return touchedSet.count;
    },
  };
  /**
   * Who else wants to know a page has just been named. `touchPage` is the only place the three ways
   * a cluster's coverage flips go through — bytes received, bytes returned, cache slot taken or
   * returned — so the cut totals hook there without a list being walked once more. Notified on every
   * call, duplicates included: what it does is idempotent, and a flip both ways must not go unseen.
   * One only, because cut publication is unique: a subscriber list would suggest the opposite.
   */
  let watcher: ((page: number) => void) | undefined;
  const touchPage = (page: number) => {
    touchedSet.add(page);
    if (watcher) watcher(page);
  };
  return {
    residencyChanges,
    noteResidencyChange: (page: number) => void changed.add(page),
    sortResidencyChanges,
    clearResidencyChanges,
    touched,
    touchPage,
    watchTouched: (abonne: (page: number) => void) => void (watcher = abonne),
    clearTouched: touchedSet.clear,
  };
}
